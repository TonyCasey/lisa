/**
 * MCP (Model Context Protocol) client interface.
 * Handles communication with Graphiti MCP server or Zep Cloud.
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
   * @param method - Method name (e.g., 'search_memory_facts', 'add_memory')
   * @param params - Method parameters
   * @param sessionId - Optional session ID (uses cached if not provided)
   * @param timeoutMs - Timeout in milliseconds
   * @returns Tuple of [result, sessionId]
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
   */
  getSessionId(): string | null;
}
