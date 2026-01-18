/**
 * Connection Manager Interfaces
 *
 * Abstractions for managing connections to different backends.
 */

/**
 * Base connection configuration.
 */
export interface IConnectionConfig {
  /** Endpoint URL */
  readonly endpoint: string;
  /** Connection timeout in milliseconds */
  readonly timeout?: number;
}

/**
 * MCP-specific connection configuration.
 */
export interface IMcpConnectionConfig extends IConnectionConfig {
  /** API key for authentication (e.g., Zep Cloud) */
  readonly apiKey?: string;
}

/**
 * Neo4j-specific connection configuration.
 */
export interface INeo4jConnectionConfig {
  /** Bolt URI (e.g., bolt://localhost:7687) */
  readonly uri: string;
  /** Database username */
  readonly username: string;
  /** Database password */
  readonly password: string;
  /** Database name (defaults to neo4j) */
  readonly database?: string;
  /** Connection timeout in milliseconds */
  readonly timeout?: number;
}

/**
 * Zep Cloud-specific connection configuration.
 */
export interface IZepConnectionConfig extends IConnectionConfig {
  /** Zep API key (required) */
  readonly apiKey: string;
}

/**
 * Connection manager interface.
 * Manages lifecycle and health of a single backend connection.
 */
export interface IConnectionManager<TConfig = IConnectionConfig> {
  /**
   * Initialize/establish the connection.
   * For MCP, this creates a session.
   * For Neo4j, this verifies connectivity.
   */
  connect(): Promise<void>;

  /**
   * Check if the connection is healthy.
   */
  isConnected(): Promise<boolean>;

  /**
   * Close the connection gracefully.
   */
  disconnect(): Promise<void>;

  /**
   * Get the current configuration.
   */
  getConfig(): TConfig;

  /**
   * Execute a backend-specific query.
   * @param query - Backend-specific query (Cypher, MCP method, etc.)
   */
  execute<T>(query: unknown): Promise<T>;
}

/**
 * MCP connection manager interface.
 */
export interface IMcpConnectionManager extends IConnectionManager<IMcpConnectionConfig> {
  /**
   * Get the current MCP session ID.
   */
  getSessionId(): string | null;

  /**
   * Call an MCP method.
   * @param method - MCP method name
   * @param params - Method parameters
   */
  call<T>(method: string, params?: Record<string, unknown>): Promise<T>;
}

/**
 * Neo4j connection manager interface.
 */
export interface INeo4jConnectionManager extends IConnectionManager<INeo4jConnectionConfig> {
  /**
   * Execute a Cypher query.
   * @param cypher - Cypher query string
   * @param params - Query parameters
   */
  query<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
}

/**
 * Zep Cloud connection manager interface.
 */
export interface IZepConnectionManager extends IConnectionManager<IZepConnectionConfig> {
  /**
   * Make a Zep API request.
   * @param path - API path
   * @param options - Fetch options
   */
  fetch<T>(path: string, options?: RequestInit): Promise<T>;
}
