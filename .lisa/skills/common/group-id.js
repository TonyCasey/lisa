"use strict";
/**
 * Group ID Utilities
 *
 * Shared functions for normalizing paths to Graphiti group IDs.
 * Used by memory, tasks, prompt, and other skills.
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREFIX_MAP = exports.TYPE_MAP = exports.MAX_GROUP_ID_LENGTH = void 0;
exports.normalizePathToGroupId = normalizePathToGroupId;
exports.getCurrentGroupId = getCurrentGroupId;
exports.isWindows = isWindows;
exports.getRootBoundary = getRootBoundary;
exports.getHierarchicalGroupIds = getHierarchicalGroupIds;
exports.detectPrefixTag = detectPrefixTag;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
exports.MAX_GROUP_ID_LENGTH = 128;
/**
 * Normalize a path to a valid group ID string.
 * Works cross-platform (Windows and Unix).
 *
 * @example
 * normalizePathToGroupId('/Users/tony.casey/Repos/api') // 'users-tony_casey-repos-api'
 * normalizePathToGroupId('C:\\dev\\lisa') // 'c-dev-lisa'
 */
function normalizePathToGroupId(absolutePath) {
    let normalized = absolutePath
        .toLowerCase()
        .replace(/^[a-z]:/i, (match) => match.charAt(0)) // C: -> c
        .replace(/^\//, '') // Remove leading slash (Unix)
        .replace(/\\/g, '-') // Backslash to dash (Windows)
        .replace(/\//g, '-') // Forward slash to dash (Unix)
        .replace(/\./g, '_') // Dots to underscores
        .replace(/^-+/, '') // Remove leading dashes
        .replace(/-+/g, '-'); // Collapse multiple dashes
    if (normalized.length > exports.MAX_GROUP_ID_LENGTH) {
        normalized = normalized.slice(-exports.MAX_GROUP_ID_LENGTH);
    }
    return normalized;
}
/**
 * Get the current folder's group ID.
 */
function getCurrentGroupId(cwd = process.cwd()) {
    return normalizePathToGroupId(cwd);
}
/**
 * Check if we're on Windows
 */
function isWindows() {
    return os.platform() === 'win32';
}
/**
 * Get the root boundary for hierarchical traversal.
 * - Windows: drive root (e.g., C:\) or home directory, whichever is deeper
 * - Unix: home directory or /
 */
function getRootBoundary(cwd = process.cwd()) {
    const homeDir = os.homedir();
    if (isWindows()) {
        // On Windows, check if cwd is under home directory
        const cwdLower = cwd.toLowerCase();
        const homeLower = homeDir.toLowerCase();
        if (cwdLower.startsWith(homeLower)) {
            return homeDir; // Under home, use home as boundary
        }
        // Not under home (e.g., C:\dev\), use drive root as boundary
        const driveRoot = path.parse(cwd).root; // e.g., "C:\"
        return driveRoot;
    }
    // Unix: use home directory if under it, otherwise use /
    if (cwd.startsWith(homeDir)) {
        return homeDir;
    }
    return '/';
}
/**
 * Get hierarchical group IDs from current folder up to root boundary.
 * Returns array ordered from most specific (current) to least specific (root).
 * Works cross-platform (Windows and Unix).
 */
function getHierarchicalGroupIds(cwd = process.cwd()) {
    const rootBoundary = getRootBoundary(cwd);
    const groups = [];
    let currentPath = path.resolve(cwd);
    const maxDepth = 10; // Safety limit
    let depth = 0;
    while (depth < maxDepth) {
        groups.push(normalizePathToGroupId(currentPath));
        // Stop if we've reached the root boundary
        if (currentPath.toLowerCase() === rootBoundary.toLowerCase()) {
            break;
        }
        const parentPath = path.dirname(currentPath);
        // Stop if we can't go up anymore (reached filesystem root)
        if (parentPath === currentPath) {
            break;
        }
        currentPath = parentPath;
        depth++;
    }
    return groups;
}
/**
 * Entity type to tag mapping for memory classification.
 */
exports.TYPE_MAP = {
    // Code & Architecture
    'decision': 'code:decision',
    'pattern': 'code:pattern',
    'dependency': 'code:dependency',
    'tech-debt': 'code:tech-debt',
    // Context & History
    'bug': 'context:bug',
    'rationale': 'context:rationale',
    'failed': 'context:failed',
    'quirk': 'context:quirk',
    // External
    'feedback': 'external:feedback',
    'incident': 'external:incident',
    'contract': 'external:contract',
    // People & Process
    'contributor': 'people:contributor',
    'review': 'people:review',
    'blocker': 'people:blocker',
    'estimate': 'people:estimate',
    // Project
    'scope-in': 'project:scope-in',
    'scope-out': 'project:scope-out',
    'milestone': 'project:milestone',
    'init-review': 'type:init-review',
};
/**
 * Auto-detect prefixes in text for automatic tagging.
 */
exports.PREFIX_MAP = {
    'DECISION:': 'code:decision',
    'PATTERN:': 'code:pattern',
    'TECH-DEBT:': 'code:tech-debt',
    'BUG:': 'context:bug',
    'RATIONALE:': 'context:rationale',
    'FAILED:': 'context:failed',
    'INCIDENT:': 'external:incident',
    'BLOCKER:': 'people:blocker',
    'SCOPE-IN:': 'project:scope-in',
    'SCOPE-OUT:': 'project:scope-out',
    'INIT-REVIEW:': 'type:init-review',
};
/**
 * Detect tag from text prefix.
 */
function detectPrefixTag(text) {
    for (const [prefix, tag] of Object.entries(exports.PREFIX_MAP)) {
        if (text.toUpperCase().startsWith(prefix)) {
            return tag;
        }
    }
    return null;
}
//# sourceMappingURL=group-id.js.map