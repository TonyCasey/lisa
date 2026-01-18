"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTaskCliService = createTaskCliService;
/**
 * Creates a task CLI service instance.
 */
function createTaskCliService(deps) {
    const { env, logger, cache, taskService, getGroupIds, getCurrentGroupId } = deps;
    return {
        async run(args) {
            const { command, payload, explicitGroup, limit, status, tag, repo, assignee, notes } = args;
            if (!['add', 'list', 'update'].includes(command)) {
                throw new Error('command must be add|list|update');
            }
            const groupId = explicitGroup || env.GRAPHITI_GROUP_ID || getCurrentGroupId();
            logger.info(`Executing command: ${command}`, { mode: env.STORAGE_MODE, group: groupId });
            let result;
            if (command === 'list') {
                const groupIds = explicitGroup ? [explicitGroup] : getGroupIds();
                logger.debug('Using Neo4j direct mode for list');
                result = await taskService.list(groupIds, limit, repo, assignee);
            }
            else if (command === 'add') {
                if (!payload)
                    throw new Error('add requires task text (title)');
                result = await taskService.add(payload, groupId, { status, repo, assignee, notes, tag });
            }
            else {
                if (!payload)
                    throw new Error('update requires task text (title)');
                result = await taskService.update(payload, groupId, { status, repo, assignee, notes, tag });
            }
            const tasksCount = 'tasks' in result ? result.tasks?.length ?? 0 : 0;
            logger.info(`Command completed: ${command}`, { mode: env.STORAGE_MODE, tasksCount });
            cache.write(result);
            return result;
        },
    };
}
//# sourceMappingURL=TaskCliService.js.map