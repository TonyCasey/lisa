"use strict";
/**
 * Shared modules for Lisa skills.
 *
 * This module provides common clients and utilities used by all skills:
 * - Client interfaces and implementations for Neo4j, MCP, and Zep
 * - Utility functions for caching, logging, environment, and group IDs
 *
 * Usage:
 *   import { createMcpClient, createLogger, loadEnv, getCurrentGroupId } from '../shared';
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
// Re-export everything from clients
__exportStar(require("./clients"), exports);
// Re-export everything from utils
__exportStar(require("./utils"), exports);
//# sourceMappingURL=index.js.map