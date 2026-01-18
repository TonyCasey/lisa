"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPromptService = createPromptService;
/**
 * Prompt service - captures user prompts to Graphiti MCP.
 */
const crypto_1 = __importDefault(require("crypto"));
/**
 * Creates a prompt service instance.
 */
function createPromptService(deps) {
    const { mcpClient } = deps;
    return {
        fingerprint(text) {
            return crypto_1.default.createHash('sha1').update(text.trim()).digest('hex').slice(0, 16);
        },
        async addPrompt(args) {
            const { text, role = 'user', source = 'user-prompt', force = false, groupId } = args;
            if (!text)
                throw new Error('prompt requires text');
            const fp = this.fingerprint(text);
            const fpTag = `fingerprint:${fp}`;
            await mcpClient.initialize();
            // Check for duplicates unless force
            if (!force) {
                try {
                    const searchParams = { query: fp, tags: [fpTag], max_nodes: 1, group_ids: [groupId] };
                    const existing = await mcpClient.rpcCall('search_nodes', searchParams);
                    const nodes = existing?.nodes || [];
                    if (nodes.length > 0) {
                        return { status: 'skipped', reason: 'duplicate' };
                    }
                }
                catch {
                    // Ignore dedupe errors
                }
            }
            const params = {
                name: text.substring(0, 100),
                episode_body: text,
                source,
                group_id: groupId,
                tags: [fpTag, `role:${role}`, `source:${source}`],
            };
            await mcpClient.rpcCall('add_memory', params);
            return { status: 'ok', action: 'add', group: groupId, role, source };
        },
    };
}
//# sourceMappingURL=PromptService.js.map