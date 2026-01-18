/**
 * Interface for MCP (Model Context Protocol) client operations.
 * Used for communicating with Graphiti MCP server.
 */
export interface IMcpClient {
  /**
   * Initialize the MCP session.
   * @returns The session ID for subsequent calls
   */
  initialize(): Promise<string>;

  /**
   * Make an RPC call to the MCP server.
   * @param method - The RPC method name (e.g., 'add_memory', 'search_memory_facts')
   * @param params - Method parameters
   * @returns The RPC response result
   */
  rpcCall<T>(method: string, params: Record<string, unknown>): Promise<T>;

  /**
   * Get the current session ID (null if not initialized).
   */
  getSessionId(): string | null;

  /**
   * Check if the client has an active session.
   */
  isInitialized(): boolean;
}

/**
 * Configuration options for creating an MCP client.
 */
export interface IMcpClientConfig {
  /** MCP endpoint URL (e.g., http://localhost:8010/mcp/) */
  endpoint: string;
  /** Client name for identification */
  clientName?: string;
  /** Client version */
  clientVersion?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * MCP RPC response structure.
 */
export interface IMcpRpcResponse<T = unknown> {
  jsonrpc: string;
  id: string;
  result?: {
    structuredContent?: {
      result?: T;
    };
  } & T;
  error?: {
    code: number;
    message: string;
  };
}
