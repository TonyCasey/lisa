"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createZepClient = createZepClient;
exports.createZepConfigFromEnv = createZepConfigFromEnv;
const DEFAULT_BASE_URL = 'https://api.getzep.com/api/v2';
const DEFAULT_TIMEOUT_MS = 15000;
/**
 * Creates a Zep Cloud client instance.
 */
function createZepClient(config) {
    const apiKey = config.apiKey;
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    /**
     * Make an authenticated request to Zep API.
     */
    async function zepFetch(urlPath, options = {}) {
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
        let data;
        try {
            data = text ? JSON.parse(text) : {};
        }
        catch (_err) {
            throw new Error(`Zep invalid JSON (${resp.status}): ${text.slice(0, 200)}`);
        }
        if (!resp.ok) {
            const errorMsg = data.message ||
                (data.error?.message) ||
                (data.error?.detail) ||
                `HTTP ${resp.status}`;
            throw new Error(errorMsg);
        }
        return data;
    }
    return {
        async ensureUser(userId) {
            try {
                await zepFetch('/users', {
                    method: 'POST',
                    body: JSON.stringify({
                        user_id: userId,
                        first_name: 'Lisa',
                        last_name: 'Memory',
                    }),
                });
            }
            catch (err) {
                // User already exists is ok
                if (!(err instanceof Error && err.message.includes('already exists'))) {
                    throw err;
                }
            }
        },
        async getOrCreateThread(threadId, userId, metadata) {
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
            }
            catch (err) {
                // Thread already exists is ok
                if (!(err instanceof Error && err.message.includes('already exists'))) {
                    throw err;
                }
            }
        },
        async addMessage(threadId, content, role = 'user') {
            const result = await zepFetch(`/threads/${encodeURIComponent(threadId)}/messages`, {
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
            });
            return { message_uuid: result.message_uuids?.[0] };
        },
        async getMessages(threadId, limit = 20) {
            try {
                const result = await zepFetch(`/threads/${encodeURIComponent(threadId)}/messages?limit=${limit}`);
                return result.messages || [];
            }
            catch (err) {
                // Thread may not exist yet
                if (err instanceof Error &&
                    (err.message.includes('not found') || err.message.includes('404'))) {
                    return [];
                }
                throw err;
            }
        },
        async searchFacts(userId, query, limit = 10) {
            try {
                const result = await zepFetch('/graph/search', {
                    method: 'POST',
                    body: JSON.stringify({
                        user_id: userId,
                        query,
                        limit,
                        search_scope: 'facts',
                    }),
                });
                const facts = (result.edges || []).map((edge) => ({
                    uuid: edge.uuid,
                    name: edge.name,
                    fact: edge.fact,
                    created_at: edge.created_at,
                }));
                return { facts };
            }
            catch (_err) {
                // User might not exist yet
                return { facts: [] };
            }
        },
        // ========================================================================
        // High-level Task Operations
        // ========================================================================
        async addTask(groupId, task) {
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
        async listTasks(groupIds, limit) {
            const allTasks = [];
            const perGroupLimit = Math.ceil(limit / groupIds.length);
            for (const gid of groupIds) {
                const threadId = `lisa-tasks-${gid}`;
                const messages = await this.getMessages(threadId, perGroupLimit);
                // Parse tasks from messages
                for (const msg of messages) {
                    const content = msg.content || '';
                    if (!content.startsWith('TASK:'))
                        continue;
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
                    }
                    catch {
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
            allTasks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            return allTasks.slice(0, limit);
        },
        // ========================================================================
        // High-level Memory Operations
        // ========================================================================
        async addMemory(groupId, text, options) {
            const userId = `lisa-${groupId}`;
            const threadId = `lisa-memory-${groupId}`;
            // Ensure user and thread exist
            await this.ensureUser(userId);
            await this.getOrCreateThread(threadId, userId, { type: 'memory' });
            // Include tag in the text for Zep (Zep extracts facts from message content)
            const textWithTag = options?.tag ? `[${options.tag}] ${text}` : text;
            return this.addMessage(threadId, textWithTag);
        },
        async loadMemories(groupIds, query, limit) {
            const allFacts = [];
            const perGroupLimit = Math.ceil(limit / groupIds.length);
            for (const gid of groupIds) {
                const userId = `lisa-${gid}`;
                const searchQuery = query && query !== '*' ? query : gid;
                const result = await this.searchFacts(userId, searchQuery, perGroupLimit);
                allFacts.push(...result.facts);
            }
            // Sort by created_at descending
            allFacts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            return allFacts.slice(0, limit);
        },
    };
}
/**
 * Creates Zep client config from environment variables.
 */
function createZepConfigFromEnv(env = {}) {
    const apiKey = env.ZEP_API_KEY || process.env.ZEP_API_KEY;
    if (!apiKey) {
        return null; // Zep not configured
    }
    return {
        apiKey,
        baseUrl: env.ZEP_BASE_URL || process.env.ZEP_BASE_URL,
    };
}
//# sourceMappingURL=ZepClient.js.map