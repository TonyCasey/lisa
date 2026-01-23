/**
 * Interface for Zep Cloud API client operations.
 * Used for cloud-based memory storage without Docker.
 */
export interface IZepClient {
  /**
   * Ensure a user exists in Zep (creates if not exists).
   * @param userId - The user identifier
   */
  ensureUser(userId: string): Promise<void>;

  /**
   * Get or create a thread for storing messages.
   * @param threadId - The thread identifier
   * @param userId - The user who owns the thread
   * @param metadata - Optional thread metadata
   */
  getOrCreateThread(
    threadId: string,
    userId: string,
    metadata?: Record<string, unknown>
  ): Promise<void>;

  /**
   * Add a message to a thread.
   * @param threadId - The thread to add the message to
   * @param content - Message content
   * @param role - Message role (default: 'user')
   * @returns The created message UUID
   */
  addMessage(
    threadId: string,
    content: string,
    role?: string
  ): Promise<{ message_uuid?: string }>;

  /**
   * Get messages from a thread.
   * @param threadId - The thread to get messages from
   * @param limit - Maximum number of messages to return
   * @returns Array of messages
   */
  getMessages(threadId: string, limit?: number): Promise<IZepMessage[]>;

  /**
   * Search for facts in the knowledge graph.
   * @param userId - The user whose facts to search
   * @param query - Search query
   * @param limit - Maximum number of facts to return
   * @returns Search results with facts and scores
   */
  searchFacts(
    userId: string,
    query: string,
    limit?: number
  ): Promise<IZepSearchResult>;

  // ============================================================================
  // High-level Task Operations
  // ============================================================================

  /**
   * Add a task to Zep storage.
   * @param groupId - The group/project identifier
   * @param task - Task data to store
   * @returns The created message UUID
   */
  addTask(
    groupId: string,
    task: {
      title: string;
      status: string;
      repo: string;
      assignee: string;
      notes?: string;
      tag?: string | null;
      externalLink?: {
        source: string;
        id: string;
        url: string;
        syncedAt?: string;
      };
    } | Record<string, unknown>
  ): Promise<{ message_uuid?: string }>;

  /**
   * List tasks from Zep storage.
   * @param groupIds - Group identifiers to search
   * @param limit - Maximum number of tasks to return
   * @returns Parsed tasks
   */
  listTasks(groupIds: string[], limit: number): Promise<IZepTask[]>;

  // ============================================================================
  // High-level Memory Operations
  // ============================================================================

  /**
   * Add a memory/fact to Zep storage.
   * @param groupId - The group/project identifier
   * @param text - Memory text content
   * @param options - Optional tag and source
   * @returns The created message UUID
   */
  addMemory(
    groupId: string,
    text: string,
    options?: { tag?: string; source?: string }
  ): Promise<{ message_uuid?: string }>;

  /**
   * Load memories from Zep storage.
   * @param groupIds - Group identifiers to search
   * @param query - Optional search query
   * @param limit - Maximum number of memories to return
   * @returns Parsed memories/facts
   */
  loadMemories(
    groupIds: string[],
    query: string,
    limit: number
  ): Promise<IZepFact[]>;
}

/**
 * A message stored in Zep.
 */
export interface IZepMessage {
  uuid: string;
  content: string;
  role: string;
  role_type?: string;
  created_at: string;
}

/**
 * A parsed task from Zep messages.
 */
export interface IZepTask {
  title: string;
  status: string;
  repo: string;
  assignee: string;
  notes?: string;
  tag?: string | null;
  message_uuid: string;
  created_at: string;
}

/**
 * A parsed memory/fact from Zep messages.
 */
export interface IZepMemory {
  text: string;
  tag?: string;
  message_uuid: string;
  created_at: string;
}

/**
 * A fact extracted by Zep from messages.
 */
export interface IZepFact {
  uuid: string;
  name: string;
  fact: string;
  created_at: string;
}

/**
 * Search result from Zep's graph search.
 */
export interface IZepSearchResult {
  facts: IZepFact[];
}

/**
 * Configuration options for creating a Zep client.
 */
export interface IZepClientConfig {
  /** Zep Cloud API key */
  apiKey: string;
  /** Base URL (default: https://api.getzep.com/api/v2) */
  baseUrl?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
}
