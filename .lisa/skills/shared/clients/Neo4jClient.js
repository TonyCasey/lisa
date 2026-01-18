"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNeo4jClient = createNeo4jClient;
exports.createNeo4jConfigFromEnv = createNeo4jConfigFromEnv;
/**
 * Creates a Neo4j client instance.
 * Uses dynamic import to avoid bundling neo4j-driver when not needed.
 */
function createNeo4jClient(config) {
    let driver = null;
    let neo4j = null;
    const database = config.database ?? 'neo4j';
    return {
        async connect() {
            if (driver)
                return; // Already connected
            // Dynamic import to avoid bundling neo4j-driver when not needed
            neo4j = require('neo4j-driver');
            driver = neo4j.driver(config.uri, neo4j.auth.basic(config.username, config.password), {
                maxConnectionPoolSize: config.maxConnectionPoolSize ?? 5,
                connectionTimeout: config.connectionTimeout ?? 10000,
            });
            await driver.verifyConnectivity();
        },
        async query(cypher, params = {}) {
            if (!driver || !neo4j) {
                throw new Error('Neo4j client not connected. Call connect() first.');
            }
            const session = driver.session({
                database,
                defaultAccessMode: neo4j.session.READ,
            });
            try {
                const result = await session.run(cypher, params);
                return result.records.map((record) => {
                    const obj = {};
                    for (const key of record.keys) {
                        let value = record.get(key);
                        // Convert Neo4j Integer to number
                        if (neo4j.isInt(value)) {
                            value = value.toNumber();
                        }
                        // Convert Neo4j DateTime/Date to string
                        if (value &&
                            typeof value.toString === 'function' &&
                            (neo4j.isDateTime(value) || neo4j.isDate(value))) {
                            value = value.toString();
                        }
                        obj[key] = value;
                    }
                    return obj;
                });
            }
            finally {
                await session.close();
            }
        },
        async disconnect() {
            if (driver) {
                await driver.close();
                driver = null;
                neo4j = null;
            }
        },
        isConnected() {
            return driver !== null;
        },
    };
}
/**
 * Creates Neo4j client config from environment variables.
 */
function createNeo4jConfigFromEnv(env = {}) {
    return {
        uri: env.NEO4J_URI || process.env.NEO4J_URI || 'bolt://localhost:7687',
        username: env.NEO4J_USER || process.env.NEO4J_USER || 'neo4j',
        password: env.NEO4J_PASSWORD || process.env.NEO4J_PASSWORD || 'demodemo',
        database: env.NEO4J_DATABASE || process.env.NEO4J_DATABASE || 'neo4j',
    };
}
//# sourceMappingURL=Neo4jClient.js.map