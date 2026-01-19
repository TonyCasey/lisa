/**
 * Interface for Neo4j database client operations.
 * Used for direct graph database queries (bypasses MCP for reads).
 */
export interface INeo4jClient {
  /**
   * Establish connection to Neo4j database.
   */
  connect(): Promise<void>;

  /**
   * Execute a Cypher query and return typed results.
   * @param cypher - The Cypher query string
   * @param params - Optional query parameters
   * @returns Array of query results
   */
  query<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;

  /**
   * Close the database connection.
   */
  disconnect(): Promise<void>;

  /**
   * Check if the client is currently connected.
   */
  isConnected(): boolean;
}

/**
 * Configuration options for creating a Neo4j client.
 */
export interface INeo4jClientConfig {
  /** Neo4j connection URI (e.g., bolt://localhost:7687) */
  uri: string;
  /** Database username */
  username: string;
  /** Database password */
  password: string;
  /** Database name (default: 'neo4j') */
  database?: string;
  /** Maximum connection pool size */
  maxConnectionPoolSize?: number;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
}
