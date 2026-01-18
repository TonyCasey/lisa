"use strict";
/**
 * Shared utility implementations and interfaces.
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
exports.nullCache = exports.createCacheConfig = exports.createCache = exports.hasArgFlag = exports.getFlag = exports.parseArgs = exports.hasFlag = exports.popFlag = exports.createZepThreadId = exports.createZepUserId = exports.normalizeGroupId = exports.getHierarchicalGroupIds = exports.getGroupIds = exports.getCurrentGroupId = exports.isLocalMcpConfigured = exports.isNeo4jConfigured = exports.isZepCloudConfigured = exports.loadEnv = exports.logger = exports.createConsoleLogger = exports.createLogger = exports.createCacheConfigFromSkill = exports.createFileCache = void 0;
// Re-export interfaces
__exportStar(require("./interfaces"), exports);
// Export utility factories and functions
var FileCache_1 = require("./FileCache");
Object.defineProperty(exports, "createFileCache", { enumerable: true, get: function () { return FileCache_1.createFileCache; } });
Object.defineProperty(exports, "createCacheConfigFromSkill", { enumerable: true, get: function () { return FileCache_1.createCacheConfigFromSkill; } });
var Logger_1 = require("./Logger");
Object.defineProperty(exports, "createLogger", { enumerable: true, get: function () { return Logger_1.createLogger; } });
Object.defineProperty(exports, "createConsoleLogger", { enumerable: true, get: function () { return Logger_1.createConsoleLogger; } });
Object.defineProperty(exports, "logger", { enumerable: true, get: function () { return Logger_1.logger; } });
var env_1 = require("./env");
Object.defineProperty(exports, "loadEnv", { enumerable: true, get: function () { return env_1.loadEnv; } });
Object.defineProperty(exports, "isZepCloudConfigured", { enumerable: true, get: function () { return env_1.isZepCloudConfigured; } });
Object.defineProperty(exports, "isNeo4jConfigured", { enumerable: true, get: function () { return env_1.isNeo4jConfigured; } });
Object.defineProperty(exports, "isLocalMcpConfigured", { enumerable: true, get: function () { return env_1.isLocalMcpConfigured; } });
var group_id_1 = require("./group-id");
Object.defineProperty(exports, "getCurrentGroupId", { enumerable: true, get: function () { return group_id_1.getCurrentGroupId; } });
Object.defineProperty(exports, "getGroupIds", { enumerable: true, get: function () { return group_id_1.getGroupIds; } });
Object.defineProperty(exports, "getHierarchicalGroupIds", { enumerable: true, get: function () { return group_id_1.getHierarchicalGroupIds; } });
Object.defineProperty(exports, "normalizeGroupId", { enumerable: true, get: function () { return group_id_1.normalizeGroupId; } });
Object.defineProperty(exports, "createZepUserId", { enumerable: true, get: function () { return group_id_1.createZepUserId; } });
Object.defineProperty(exports, "createZepThreadId", { enumerable: true, get: function () { return group_id_1.createZepThreadId; } });
// CLI argument parsing
var cli_1 = require("./cli");
Object.defineProperty(exports, "popFlag", { enumerable: true, get: function () { return cli_1.popFlag; } });
Object.defineProperty(exports, "hasFlag", { enumerable: true, get: function () { return cli_1.hasFlag; } });
Object.defineProperty(exports, "parseArgs", { enumerable: true, get: function () { return cli_1.parseArgs; } });
Object.defineProperty(exports, "getFlag", { enumerable: true, get: function () { return cli_1.getFlag; } });
Object.defineProperty(exports, "hasArgFlag", { enumerable: true, get: function () { return cli_1.hasArgFlag; } });
// Cache utilities
var cache_1 = require("./cache");
Object.defineProperty(exports, "createCache", { enumerable: true, get: function () { return cache_1.createCache; } });
Object.defineProperty(exports, "createCacheConfig", { enumerable: true, get: function () { return cache_1.createCacheConfig; } });
Object.defineProperty(exports, "nullCache", { enumerable: true, get: function () { return cache_1.nullCache; } });
//# sourceMappingURL=index.js.map