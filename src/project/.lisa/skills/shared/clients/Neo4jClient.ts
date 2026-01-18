/**
 * Neo4j client implementation for direct database queries.
 * Bypasses MCP for reads to get better date ordering.
 */
import type { INeo4jClient, INeo4jClientConfig } from './interfaces';

/**
 * Creates a Neo4j client instance.
 * Uses dynamic import to avoid bundling neo4j-driver when not needed.
 */
export function createNeo4jClient(config: INeo4jClientConfig): INeo4jClient {
  let driver: any = null;
  let neo4j: any = null;
  const database = config.database ?? 'neo4j';

  return {
    async connect(): Promise<void> {
      if (driver) return; // Already connected

      // Dynamic import to avoid bundling neo4j-driver when not needed
      neo4j = require('neo4j-driver');
      driver = neo4j.driver(
        config.uri,
        neo4j.auth.basic(config.username, config.password),
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
        const result = await session.run(cypher, params);
        return result.records.map((record: any) => {
          const obj: Record<string, unknown> = {};
          for (const key of record.keys) {
            let value = record.get(key);

            // Convert Neo4j Integer to number
            if (neo4j.isInt(value)) {
              value = value.toNumber();
            }

            // Convert Neo4j DateTime/Date to string
            if (
              value &&
              typeof value.toString === 'function' &&
              (neo4j.isDateTime(value) || neo4j.isDate(value))
            ) {
              value = value.toString();
            }

            obj[key] = value;
          }
          return obj as T;
        });
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
