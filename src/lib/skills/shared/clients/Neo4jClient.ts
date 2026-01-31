/**
 * Neo4j client implementation for direct database queries.
 * Bypasses MCP for reads to get better date ordering.
 */
import type { INeo4jClient, INeo4jClientConfig } from './interfaces';

/**
 * Neo4j driver instance type (dynamic import prevents static typing).
 */
interface INeo4jDriver {
  session(options: { database: string; defaultAccessMode: unknown }): INeo4jSession;
  verifyConnectivity(): Promise<void>;
  close(): Promise<void>;
}

interface INeo4jSession {
  run(cypher: string, params: Record<string, unknown>): Promise<{ records: INeo4jRecord[] }>;
  close(): Promise<void>;
}

interface INeo4jRecord {
  keys: string[];
  get(key: string): unknown;
}

interface INeo4jModule {
  driver(uri: string, auth: unknown, options: Record<string, unknown>): INeo4jDriver;
  auth: { basic(username: string, password: string): unknown };
  session: { READ: unknown; WRITE: unknown };
  int(value: number): unknown;
  isInt(value: unknown): boolean;
  isDateTime(value: unknown): boolean;
  isDate(value: unknown): boolean;
}

/**
 * Creates a Neo4j client instance.
 * Uses dynamic import to avoid bundling neo4j-driver when not needed.
 */
export function createNeo4jClient(config: INeo4jClientConfig): INeo4jClient {
  let driver: INeo4jDriver | null = null;
  let neo4j: INeo4jModule | null = null;
  const database = config.database ?? 'neo4j';

  /**
   * Convert integer parameters to Neo4j Integer type.
   * JavaScript numbers are passed as floats, but LIMIT and other
   * integer-requiring clauses need Neo4j Integer values.
   */
  function convertParams(params: Record<string, unknown>): Record<string, unknown> {
    if (!neo4j) return params;
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'number' && Number.isInteger(value)) {
        converted[key] = neo4j.int(value);
      } else {
        converted[key] = value;
      }
    }
    return converted;
  }

  /**
   * Map Neo4j records to plain objects, converting Neo4j types.
   */
  function mapRecords<T>(records: INeo4jRecord[]): T[] {
    return records.map((record: INeo4jRecord) => {
      const obj: Record<string, unknown> = {};
      for (const key of record.keys) {
        let value = record.get(key);

        // Convert Neo4j Integer to number
        if (neo4j!.isInt(value)) {
          value = (value as { toNumber(): number }).toNumber();
        }

        // Convert Neo4j DateTime/Date to string
        if (
          value &&
          typeof (value as { toString?: () => string }).toString === 'function' &&
          (neo4j!.isDateTime(value) || neo4j!.isDate(value))
        ) {
          value = (value as { toString(): string }).toString();
        }

        obj[key] = value;
      }
      return obj as T;
    });
  }

  return {
    async connect(): Promise<void> {
      if (driver) return; // Already connected

      // Dynamic import to avoid bundling neo4j-driver when not needed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const neo4jModule: INeo4jModule = require('neo4j-driver');
      neo4j = neo4jModule;
      driver = neo4jModule.driver(
        config.uri,
        neo4jModule.auth.basic(config.username, config.password),
        {
          maxConnectionPoolSize: config.maxConnectionPoolSize ?? 5,
          connectionTimeout: config.connectionTimeout ?? 10000,
        }
      );
      await driver.verifyConnectivity();
    },

    async query<T>(
      cypher: string,
      params: Record<string, unknown> = {}
    ): Promise<T[]> {
      if (!driver || !neo4j) {
        throw new Error('Neo4j client not connected. Call connect() first.');
      }

      const session = driver.session({
        database,
        defaultAccessMode: neo4j.session.READ,
      });

      try {
        const result = await session.run(cypher, convertParams(params));
        return mapRecords<T>(result.records);
      } finally {
        await session.close();
      }
    },

    async write(
      cypher: string,
      params: Record<string, unknown> = {}
    ): Promise<void> {
      if (!driver || !neo4j) {
        throw new Error('Neo4j client not connected. Call connect() first.');
      }

      const session = driver.session({
        database,
        defaultAccessMode: neo4j.session.WRITE,
      });

      try {
        await session.run(cypher, convertParams(params));
      } finally {
        await session.close();
      }
    },

    async writeQuery<T>(
      cypher: string,
      params: Record<string, unknown> = {}
    ): Promise<T[]> {
      if (!driver || !neo4j) {
        throw new Error('Neo4j client not connected. Call connect() first.');
      }

      const session = driver.session({
        database,
        defaultAccessMode: neo4j.session.WRITE,
      });

      try {
        const result = await session.run(cypher, convertParams(params));
        return mapRecords<T>(result.records);
      } finally {
        await session.close();
      }
    },

    async disconnect(): Promise<void> {
      if (driver) {
        await driver.close();
        driver = null;
        neo4j = null;
      }
    },

    isConnected(): boolean {
      return driver !== null;
    },
  };
}

/**
 * Creates Neo4j client config from environment variables.
 */
export function createNeo4jConfigFromEnv(
  env: Record<string, string> = {}
): INeo4jClientConfig {
  return {
    uri: env.NEO4J_URI || process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: env.NEO4J_USER || process.env.NEO4J_USER || 'neo4j',
    password: env.NEO4J_PASSWORD || process.env.NEO4J_PASSWORD || 'demodemo',
    database: env.NEO4J_DATABASE || process.env.NEO4J_DATABASE || 'neo4j',
  };
}
