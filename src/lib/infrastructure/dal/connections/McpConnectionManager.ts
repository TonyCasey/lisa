/**
 * MCP Connection Manager
 *
 * Wraps the existing McpClient to conform to the IConnectionManager interface.
 * Used for Graphiti MCP and Zep Cloud connections.
 */

import type {
  IMcpConnectionManager,
  IMcpConnectionConfig,
} from '../../../domain/interfaces/dal';
import { McpClient } from '../../mcp/McpClient';

/**
 * MCP Connection Manager implementation.
 * Wraps McpClient with connection lifecycle management.
 */
export class McpConnectionManager implements IMcpConnectionManager {
  private client: McpClient;
  private connected = false;

  constructor(private readonly config: IMcpConnectionConfig) {
    this.client = new McpClient(config.endpoint, config.apiKey);
  }

  /**
   * Initialize the MCP session.
   */
  async connect(): Promise<void> {
    await this.client.initialize(this.config.timeout);
    this.connected = true;
  }

  /**
   * Check if the MCP server is reachable.
   */
  async isConnected(): Promise<boolean> {
    if (!this.connected) return false;
    try {
      return await this.client.ping(this.config.timeout);
    } catch {
      return false;
    }
  }

  /**
   * Close the connection (no-op for HTTP-based MCP).
   */
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): IMcpConnectionConfig {
    return this.config;
  }

  /**
   * Execute a generic query (delegates to call).
   */
  async execute<T>(query: unknown): Promise<T> {
    const { method, params } = query as { method: string; params?: Record<string, unknown> };
    return this.call<T>(method, params);
  }

  /**
   * Get the current MCP session ID.
   */
  getSessionId(): string | null {
    return this.client.getSessionId();
  }

  /**
   * Call an MCP method.
   */
  async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    // Ensure connection
    if (!this.connected) {
      await this.connect();
    }

    const [result] = await this.client.call<T>(method, params, null, this.config.timeout);
    return result;
  }

  /**
   * Get the underlying McpClient for advanced usage.
   * @internal
   */
  getClient(): McpClient {
    return this.client;
  }
}

/**
 * Create an MCP connection manager from environment.
 */
export function createMcpConnectionManager(
  endpoint?: string,
  apiKey?: string,
  timeout?: number
): McpConnectionManager {
  const config: IMcpConnectionConfig = {
    endpoint: endpoint || process.env.GRAPHITI_ENDPOINT || 'http://localhost:8010/mcp/',
    apiKey: apiKey || process.env.ZEP_API_KEY,
    timeout: timeout || 30000,  // MCP semantic search can be slow
  };

  return new McpConnectionManager(config);
}
