#!/usr/bin/env node
export {}; // keep module scoped
// Mark a task as done using its task_id.
const { rpcCall, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { ensureUser, recordUserWork } = require('./common/user');
const { detectRepo, detectBranch, repoTags } = require('./common/context');
const { buildTags } = require('./common/tags');
const { autoFormat } = require('./common/table');

type ParsedArgs = { id?: string; num?: string; note?: string; domain?: string };

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const out: ParsedArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--id' || a === '-i') out.id = args[++i];
    if (a === '--num' || a === '-n') out.num = args[++i];
    if (a === '--note' || a === '-n') out.note = args[++i];
    if (a === '--domain' || a === '-d') out.domain = args[++i];
  }
  return out;
}

async function main() {
  const { id, num, note, domain } = parseArgs();
  if (!id && !num) {
    console.error('tasks_done requires --id <task_id> or --num <task_num>');
    process.exit(1);
  }

  const repo = detectRepo();
  const branch = detectBranch();
  const groupId = process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP_ID;

  let sessionId = null;
  [, sessionId] = await ensureUser(null, groupId);
  sessionId = await recordUserWork({ repository: repo, project: branch, groupId, sessionId });

  const status = 'done';
  const tags = [
    'type:task',
    `status:${status}`,
    ...(id ? [`task_id:${id}`] : []),
    ...(num ? [`task_num:${num}`] : []),
    ...buildTags({ domain }),
    ...repoTags({ repo, branch }),
  ];

  const params = {
    name: `Task ${id || num} done`,
    episode_body: JSON.stringify({
      task_id: id,
      task_num: num,
      status,
      note,
      repo,
      branch,
      captured_at: new Date().toISOString(),
    }),
    source: 'json',
    group_id: groupId,
    attributes: {
      status,
      task_id: id,
      task_num: num,
      note,
      repo,
      branch,
    },
    tags,
  };

  await rpcCall('add_memory', params, sessionId);
  const formatted = autoFormat([{ task: id || num, status, note }]);
  console.log(formatted || `Marked task ${id || num} as done.`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
