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
   * Execute a write transaction (Cypher mutation).
   * Uses WRITE access mode session.
   * @param cypher - The Cypher mutation query
   * @param params - Optional query parameters
   */
  write(cypher: string, params?: Record<string, unknown>): Promise<void>;

  /**
   * Execute a write transaction that returns typed results.
   * Uses WRITE access mode session with result mapping.
   * Useful for atomic SET + RETURN patterns.
   * @param cypher - The Cypher mutation query with RETURN clause
   * @param params - Optional query parameters
   * @returns Array of query results
   */
  writeQuery<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;

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
