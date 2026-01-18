"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMemoryCliService = createMemoryCliService;
/**
 * Creates a memory CLI service instance.
 */
function createMemoryCliService(deps) {
    const { env, logger, cache, memoryService, getGroupIds, getCurrentGroupId, resolveTag } = deps;
    return {
        async run(args) {
            const { command, payload, explicitGroup, hasConfiguredGroup, query, limit, explicitTag, entityType, source } = args;
            if (!['add', 'load'].includes(command)) {
                throw new Error('command must be add|load');
            }
            const groupId = explicitGroup || env.GRAPHITI_GROUP_ID || getCurrentGroupId();
            logger.info(`Executing command: ${command}`, { mode: env.STORAGE_MODE, group: groupId });
            let result;
            if (command === 'load') {
                const groupIds = hasConfiguredGroup ? [groupId] : getGroupIds();
                logger.debug('Using Neo4j direct mode for load');
                result = await memoryService.load(groupIds, query, limit);
            }
            else {
                if (!payload)
                    throw new Error('add requires text payload');
                const tag = resolveTag(payload, explicitTag, entityType);
                result = await memoryService.add(payload, groupId, { tag, type: entityType ?? undefined, source });
            }
            const factsCount = 'facts' in result ? result.facts?.length ?? 0 : 0;
            logger.info(`Command completed: ${command}`, { mode: env.STORAGE_MODE, factsCount });
            cache.write(result);
            return result;
        },
    };
}
//# sourceMappingURL=MemoryCliService.js.map