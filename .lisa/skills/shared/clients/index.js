"use strict";
/**
 * Client implementations and interfaces for backend connections.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createZepConfigFromEnv = exports.createZepClient = exports.createMcpConfigFromEnv = exports.createMcpClient = exports.createNeo4jConfigFromEnv = exports.createNeo4jClient = void 0;
// Re-export interfaces
__exportStar(require("./interfaces"), exports);
// Export client factories
var Neo4jClient_1 = require("./Neo4jClient");
Object.defineProperty(exports, "createNeo4jClient", { enumerable: true, get: function () { return Neo4jClient_1.createNeo4jClient; } });
Object.defineProperty(exports, "createNeo4jConfigFromEnv", { enumerable: true, get: function () { return Neo4jClient_1.createNeo4jConfigFromEnv; } });
var McpClient_1 = require("./McpClient");
Object.defineProperty(exports, "createMcpClient", { enumerable: true, get: function () { return McpClient_1.createMcpClient; } });
Object.defineProperty(exports, "createMcpConfigFromEnv", { enumerable: true, get: function () { return McpClient_1.createMcpConfigFromEnv; } });
var ZepClient_1 = require("./ZepClient");
Object.defineProperty(exports, "createZepClient", { enumerable: true, get: function () { return ZepClient_1.createZepClient; } });
Object.defineProperty(exports, "createZepConfigFromEnv", { enumerable: true, get: function () { return ZepClient_1.createZepConfigFromEnv; } });
//# sourceMappingURL=index.js.map