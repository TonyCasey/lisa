"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentGroupId = getCurrentGroupId;
exports.normalizeGroupId = normalizeGroupId;
exports.getGroupIds = getGroupIds;
exports.getHierarchicalGroupIds = getHierarchicalGroupIds;
exports.createZepUserId = createZepUserId;
exports.createZepThreadId = createZepThreadId;
/**
 * Shared group ID utilities for folder-based memory isolation.
 * Used by memory, tasks, and other skills.
 */
const path_1 = __importDefault(require("path"));
/**
 * Get the current folder's group ID (uses folder basename).
 * E.g., "lisa" from "C:\dev\lisa" or "/home/user/projects/lisa"
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Normalized group ID
 */
function getCurrentGroupId(cwd = process.cwd()) {
    const basename = path_1.default.basename(cwd);
    return normalizeGroupId(basename);
}
/**
 * Normalize a string to a valid Graphiti group ID.
 * Graphiti requires alphanumeric characters, dashes, and underscores only.
 *
 * @param input - String to normalize
 * @returns Normalized group ID
 */
function normalizeGroupId(input) {
    return input
        .toLowerCase()
        .replace(/\./g, '_') // Replace dots with underscores
        .replace(/[^a-z0-9_-]/g, '-'); // Replace other invalid chars with dashes
}
/**
 * Get group IDs for querying.
 * Returns array with current folder's group ID.
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Array of group IDs to query
 */
function getGroupIds(cwd = process.cwd()) {
    const groupId = getCurrentGroupId(cwd);
    return groupId ? [groupId] : [];
}
/**
 * Generate a hierarchical list of group IDs from a path.
 * E.g., "/home/user/projects/lisa/src" returns ["lisa", "projects", "user"]
 *
 * This allows querying memories from parent directories as well.
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @param maxDepth - Maximum number of parent levels to include
 * @returns Array of group IDs from current to parents
 */
function getHierarchicalGroupIds(cwd = process.cwd(), maxDepth = 3) {
    const groupIds = [];
    let currentPath = cwd;
    for (let i = 0; i < maxDepth; i++) {
        const basename = path_1.default.basename(currentPath);
        if (!basename || basename === currentPath)
            break; // Reached root
        const groupId = normalizeGroupId(basename);
        if (groupId && !groupIds.includes(groupId)) {
            groupIds.push(groupId);
        }
        currentPath = path_1.default.dirname(currentPath);
    }
    return groupIds;
}
/**
 * Create a Zep-compatible user ID from a group ID.
 * E.g., "lisa" -> "lisa-user"
 */
function createZepUserId(groupId) {
    return `lisa-${groupId}`;
}
/**
 * Create a Zep-compatible thread ID for a specific purpose.
 * E.g., ("lisa", "memory") -> "lisa-memory-lisa"
 */
function createZepThreadId(groupId, purpose) {
    return `lisa-${purpose}-${groupId}`;
}
//# sourceMappingURL=group-id.js.map