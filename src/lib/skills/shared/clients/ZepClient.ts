/**
 * Zep Cloud API client implementation.
 * Used for cloud-based memory storage without Docker.
 */
import type {
  IZepClient,
  IZepClientConfig,
  IZepMessage,
  IZepFact,
  IZepSearchResult,
  IZepTask,
} from './interfaces';

const DEFAULT_BASE_URL = 'https://api.getzep.com/api/v2';
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Creates a Zep Cloud client instance.
 */
export function createZepClient(config: IZepClientConfig): IZepClient {
  const apiKey = config.apiKey;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /**
   * Make an authenticated request to Zep API.
   */
  async function zepFetch<T>(
    urlPath: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${baseUrl}${urlPath}`;
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Api-Key ${apiKey}`,
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await resp.text();
    let data: Record<string, unknown>;

    try {
      data = text ? JSON.parse(text) : {};
    } catch (_err) {
      throw new Error(
        `Zep invalid JSON (${resp.status}): ${text.slice(0, 200)}`
      );
    }

    if (!resp.ok) {
      const errorMsg =
        (data as Record<string, string>).message ||
        ((data.error as Record<string, string>)?.message) ||
        ((data.error as Record<string, string>)?.detail) ||
        `HTTP ${resp.status}`;
      throw new Error(errorMsg);
    }

    return data as T;
  }

  return {
    async ensureUser(userId: string): Promise<void> {
      try {
        await zepFetch('/users', {
          method: 'POST',
          body: JSON.stringify({
            user_id: userId,
            first_name: 'Lisa',
            last_name: 'Memory',
          }),
        });
      } catch (err) {
        // User already exists is ok
        if (
          !(err instanceof Error && err.message.includes('already exists'))
        ) {
          throw err;
        }
      }
    },

    async getOrCreateThread(
      threadId: string,
      userId: string,
      metadata?: Record<string, unknown>
    ): Promise<void> {
      try {
        await zepFetch('/threads', {
          method: 'POST',
          body: JSON.stringify({
            thread_id: threadId,
            user_id: userId,
            metadata: {
              project: threadId,
              created_by: 'lisa',
              ...metadata,
            },
          }),
        });
      } catch (err) {
        // Thread already exists is ok
        if (
          !(err instanceof Error && err.message.includes('already exists'))
        ) {
          throw err;
        }
      }
    },

    async addMessage(
      threadId: string,
      content: string,
      role: string = 'user'
    ): Promise<{ message_uuid?: string }> {
      const result = await zepFetch<{ message_uuids?: string[] }>(
        `/threads/${encodeURIComponent(threadId)}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            messages: [
              {
                role,
                role_type: role,
                content,
              },
            ],
          }),
        }
      );
      return { message_uuid: result.message_uuids?.[0] };
    },

    async getMessages(threadId: string, limit: number = 20): Promise<IZepMessage[]> {
      try {
        const result = await zepFetch<{ messages?: IZepMessage[] }>(
          `/threads/${encodeURIComponent(threadId)}/messages?limit=${limit}`
        );
        return result.messages || [];
      } catch (err) {
        // Thread may not exist yet
        if (
          err instanceof Error &&
          (err.message.includes('not found') || err.message.includes('404'))
        ) {
          return [];
        }
        throw err;
      }
    },

    async searchFacts(
      userId: string,
      query: string,
      limit: number = 10
    ): Promise<IZepSearchResult> {
      try {
        const result = await zepFetch<{
          edges?: Array<{
            fact: string;
            name: string;
            uuid: string;
            created_at: string;
          }>;
        }>('/graph/search', {
          method: 'POST',
          body: JSON.stringify({
            user_id: userId,
            query,
            limit,
            search_scope: 'facts',
          }),
        });

        const facts: IZepFact[] = (result.edges || []).map((edge) => ({
          uuid: edge.uuid,
          name: edge.name,
          fact: edge.fact,
          created_at: edge.created_at,
        }));

        return { facts };
      } catch (_err) {
        // User might not exist yet
        return { facts: [] };
      }
    },

    // ========================================================================
    // High-level Task Operations
    // ========================================================================

    async addTask(
      groupId: string,
      task: {
        title: string;
        status: string;
        repo: string;
        assignee: string;
        notes?: string;
        tag?: string | null;
      }
    ): Promise<{ message_uuid?: string }> {
      const userId = `lisa-${groupId}`;
      const threadId = `lisa-tasks-${groupId}`;

      // Ensure user and thread exist
      await this.ensureUser(userId);
      await this.getOrCreateThread(threadId, userId, { type: 'tasks' });

      // Store task as JSON in message content
      const taskObj = { type: 'task', ...task };
      const content = `TASK: ${JSON.stringify(taskObj)}`;

      return this.addMessage(threadId, content);
    },

    async listTasks(groupIds: string[], limit: number): Promise<IZepTask[]> {
      const allTasks: IZepTask[] = [];
      const perGroupLimit = Math.ceil(limit / groupIds.length);

      for (const gid of groupIds) {
        const threadId = `lisa-tasks-${gid}`;
        const messages = await this.getMessages(threadId, perGroupLimit);

        // Parse tasks from messages
        for (const msg of messages) {
          const content = msg.content || '';
          if (!content.startsWith('TASK:')) continue;

          const jsonStr = content.slice(5).trim();
          try {
            const obj = JSON.parse(jsonStr);
            if (obj && obj.type === 'task') {
              allTasks.push({
                title: obj.title,
                status: obj.status || 'unknown',
                repo: obj.repo || gid,
                assignee: obj.assignee || 'unknown',
                notes: obj.notes,
                tag: obj.tag,
                message_uuid: msg.uuid,
                created_at: msg.created_at,
              });
            }
          } catch {
            // Not valid JSON, try to extract title
            allTasks.push({
              title: jsonStr.slice(0, 120),
              status: 'unknown',
              repo: gid,
              assignee: 'unknown',
              message_uuid: msg.uuid,
              created_at: msg.created_at,
            });
          }
        }
      }

      // Sort by created_at descending
      allTasks.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      return allTasks.slice(0, limit);
    },

    // ========================================================================
    // High-level Memory Operations
    // ========================================================================

    async addMemory(
      groupId: string,
      text: string,
      options?: { tag?: string; source?: string }
    ): Promise<{ message_uuid?: string }> {
      const userId = `lisa-${groupId}`;
      const threadId = `lisa-memory-${groupId}`;

      // Ensure user and thread exist
      await this.ensureUser(userId);
      await this.getOrCreateThread(threadId, userId, { type: 'memory' });

      // Include tag in the text for Zep (Zep extracts facts from message content)
      const textWithTag = options?.tag ? `[${options.tag}] ${text}` : text;

      return this.addMessage(threadId, textWithTag);
    },

    async loadMemories(
      groupIds: string[],
      query: string,
      limit: number
    ): Promise<IZepFact[]> {
      const allFacts: IZepFact[] = [];
      const perGroupLimit = Math.ceil(limit / groupIds.length);

      for (const gid of groupIds) {
        const userId = `lisa-${gid}`;
        const searchQuery = query && query !== '*' ? query : gid;

        const result = await this.searchFacts(userId, searchQuery, perGroupLimit);
        allFacts.push(...result.facts);
      }

      // Sort by created_at descending
      allFacts.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      return allFacts.slice(0, limit);
    },
  };
}

/**
 * Creates Zep client config from environment variables.
 */
export function createZepConfigFromEnv(
  env: Record<string, string> = {}
): IZepClientConfig | null {
  const apiKey = env.ZEP_API_KEY || process.env.ZEP_API_KEY;
  if (!apiKey) {
    return null; // Zep not configured
  }
  return {
    apiKey,
    baseUrl: env.ZEP_BASE_URL || process.env.ZEP_BASE_URL,
  };
}
