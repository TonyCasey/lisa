#!/usr/bin/env node
export {}; // keep declarations module-scoped
// Create a task node with status + optional dependencies.
const crypto = require('crypto');
const { rpcCall, DEFAULT_GROUP_ID } = require('./common/mcp-client');
const { ensureUser, recordUserWork } = require('./common/user');
const { detectRepo, detectBranch, repoTags } = require('./common/context');
const { buildTags } = require('./common/tags');
const { autoFormat } = require('./common/table');

type ParsedArgs = {
  text?: string;
  status?: string;
  blockedBy: string[];
  domain?: string;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const out: ParsedArgs = { status: 'ready', blockedBy: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--text' || a === '-t') out.text = args[++i];
    if (a === '--status' || a === '-s') out.status = args[++i];
    if (a === '--blocked-by' || a === '-b') out.blockedBy.push(args[++i]);
    if (a === '--domain' || a === '-d') out.domain = args[++i];
  }
  return out;
}

function taskIdsFromText(text: string = '') {
  const hash = crypto.createHash('sha1').update(text.trim()).digest('hex').slice(0, 12);
  const num = (parseInt(hash.slice(0, 8), 16) % 1_000_000).toString().padStart(6, '0');
  return { hash, num };
}

async function main() {
  const { text, status = 'ready', blockedBy = [], domain } = parseArgs();
  if (!text) {
    console.error('tasks_create requires --text');
    process.exit(1);
  }

  const repo = detectRepo();
  const branch = detectBranch();
  const groupId = process.env.GRAPHITI_GROUP_ID || DEFAULT_GROUP_ID;
  const { hash: taskId, num: taskNum } = taskIdsFromText(text);

  let sessionId = null;
  [, sessionId] = await ensureUser(null, groupId);
  sessionId = await recordUserWork({ repository: repo, project: branch, groupId, sessionId });

  const tags = [
    'type:task',
    `status:${status}`,
    `task_id:${taskId}`,
    `task_num:${taskNum}`,
    ...blockedBy.map((b) => `blocked_by:${b}`),
    ...buildTags({ domain }),
    ...repoTags({ repo, branch }),
  ];

  const params = {
    name: `Task: ${text.substring(0, 80)}`,
    episode_body: JSON.stringify({
      text,
      status,
      blocked_by: blockedBy,
      repo,
      branch,
      captured_at: new Date().toISOString(),
      task_id: taskId,
      task_num: taskNum,
    }),
    source: 'json',
    group_id: groupId,
    attributes: {
      status,
      task_id: taskId,
      task_num: taskNum,
      repo,
      branch,
      blocked_by: blockedBy,
    },
    tags,
  };

  await rpcCall('add_memory', params, sessionId);
  const formatted = autoFormat([{ taskId, taskNum, status, text }]);
  console.log(formatted || `Created task ${taskId} with status ${status}.`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
