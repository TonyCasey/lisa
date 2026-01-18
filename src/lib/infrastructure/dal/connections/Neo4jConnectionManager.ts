/**
 * Neo4j Connection Manager
 *
 * Manages Neo4j database connections using the official neo4j-driver.
 * Provides direct Cypher query access for date-ordered queries.
 */

import neo4j, { Driver, Session, Record as Neo4jRecord } from 'neo4j-driver';
import type {
  INeo4jConnectionManager,
  INeo4jConnectionConfig,
} from '../../../domain/interfaces/dal';

/**
 * Neo4j Connection Manager implementation.
 * Uses the official neo4j-driver for connection management.
 */
export class Neo4jConnectionManager implements INeo4jConnectionManager {
  private driver: Driver | null = null;
  private connected = false;

  constructor(private readonly config: INeo4jConnectionConfig) {}

  /**
   * Initialize the Neo4j driver and verify connectivity.
   */
  async connect(): Promise<void> {
    this.driver = neo4j.driver(
      this.config.uri,
      neo4j.auth.basic(this.config.username, this.config.password),
      {
        maxConnectionPoolSize: 10,
        connectionTimeout: this.config.timeout || 30000,
      }
    );

    // Verify connectivity
    await this.driver.verifyConnectivity();
    this.connected = true;
  }

  /**
   * Check if the Neo4j connection is healthy.
   */
  async isConnected(): Promise<boolean> {
    if (!this.connected || !this.driver) return false;
    try {
      await this.driver.verifyConnectivity();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close the Neo4j driver connection.
   */
  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
    this.connected = false;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): INeo4jConnectionConfig {
    return this.config;
  }

  /**
   * Execute a generic query (delegates to query).
   */
  async execute<T>(queryDef: unknown): Promise<T> {
    const { cypher, params } = queryDef as { cypher: string; params?: Record<string, unknown> };
    const results = await this.query<T>(cypher, params);
    return results as T;
  }

  /**
   * Execute a Cypher query and return results.
   */
  async query<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    // Ensure connection
    if (!this.connected || !this.driver) {
      await this.connect();
    }

    const session: Session = this.driver!.session({
      database: this.config.database || 'neo4j',
      defaultAccessMode: neo4j.session.READ,
    });

    try {
      const result = await session.run(cypher, params || {});
      return result.records.map((record: Neo4jRecord) => {
        // Convert Neo4j record to plain object
        const obj: Record<string, unknown> = {};
        for (const key of record.keys) {
          const keyStr = String(key);
          const value = record.get(keyStr);
          // Handle Neo4j Integer and DateTime types
          obj[keyStr] = this.convertNeo4jValue(value);
        }
        return obj as T;
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Execute a write transaction.
   */
  async write(cypher: string, params?: Record<string, unknown>): Promise<void> {
    // Ensure connection
    if (!this.connected || !this.driver) {
      await this.connect();
    }

    const session: Session = this.driver!.session({
      database: this.config.database || 'neo4j',
      defaultAccessMode: neo4j.session.WRITE,
    });

    try {
      await session.run(cypher, params || {});
    } finally {
      await session.close();
    }
  }

  /**
   * Convert Neo4j native types to JavaScript types.
   */
  private convertNeo4jValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    // Handle Neo4j Integer
    if (neo4j.isInt(value)) {
      return neo4j.int(value).toNumber();
    }

    // Handle Neo4j DateTime
    if (neo4j.isDateTime(value) || neo4j.isDate(value) || neo4j.isLocalDateTime(value)) {
      return (value as { toString(): string }).toString();
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((v) => this.convertNeo4jValue(v));
    }

    // Handle objects (including Node and Relationship)
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      // If it's a Neo4j Node or Relationship, extract properties
      if ('properties' in obj) {
        return this.convertNeo4jValue(obj.properties);
      }
      // Regular object - convert nested values
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = this.convertNeo4jValue(v);
      }
      return result;
    }

    return value;
  }

  /**
   * Get the underlying Neo4j driver for advanced usage.
   * @internal
   */
  getDriver(): Driver | null {
    return this.driver;
  }
}

/**
 * Create a Neo4j connection manager from environment.
 */
export function createNeo4jConnectionManager(
  uri?: string,
  username?: string,
  password?: string,
  database?: string,
  timeout?: number
): Neo4jConnectionManager {
  const config: INeo4jConnectionConfig = {
    uri: uri || process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: username || process.env.NEO4J_USER || 'neo4j',
    password: password || process.env.NEO4J_PASSWORD || 'demodemo',
    database: database || process.env.NEO4J_DATABASE || 'neo4j',
    timeout: timeout || 30000,
  };

  return new Neo4jConnectionManager(config);
}
