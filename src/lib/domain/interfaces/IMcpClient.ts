/**
 * MCP (Model Context Protocol) client interface.
 * Handles communication with Graphiti MCP server or Zep Cloud.
 *
 * Session Management:
 * The MCP client manages sessions internally. Callers should NOT track
 * or pass session IDs manually. The client automatically:
 * - Initializes a session on first call
 * - Updates session ID when server returns a new one
 * - Handles session expiry by re-initializing
 */
export interface IMcpClient {
  /**
   * Initialize the MCP session.
   * @param timeoutMs - Timeout in milliseconds
   * @returns Session ID
   */
  initialize(timeoutMs?: number): Promise<string>;

  /**
   * Make an RPC call to the MCP server.
   *
   * Session ID is managed internally - do not pass sessionId manually.
   * The client uses its cached session ID and updates it automatically.
   *
   * @param method - Method name (e.g., 'search_memory_facts', 'add_memory')
   * @param params - Method parameters
   * @param timeoutMs - Timeout in milliseconds
   * @returns Tuple of [result, sessionId] (sessionId returned for logging/debugging only)
   *
   * @deprecated The sessionId parameter is deprecated. Do not pass it manually.
   */
  call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string | null,
    timeoutMs?: number
  ): Promise<[T, string]>;

  /**
   * Check if the MCP server is reachable.
   * @param timeoutMs - Timeout in milliseconds
   */
  ping(timeoutMs?: number): Promise<boolean>;

  /**
   * Get the current session ID.
   * For debugging/logging purposes only.
   */
  getSessionId(): string | null;
}
