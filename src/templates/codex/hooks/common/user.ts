export {}; // keep module scoped

const os = require('os');
const { rpcCall, withGroup, DEFAULT_GROUP_ID } = require('./mcp-client');

function getUserName(): string {
  return process.env.CODING_USER_NAME || process.env.USER || os.userInfo().username || 'Developer';
}

async function ensureUser(sessionId: string | null = null, groupId: string | null = null): Promise<[string | null, string]> {
  const name = getUserName();
  const searchParams = withGroup({ query: name, max_nodes: 1 }, groupId);
  const [resp, sid] = await rpcCall('search_nodes', searchParams, sessionId);
  const nodes = resp?.result?.nodes || resp?.nodes;
  if (nodes && nodes.length) return [nodes[0].uuid, sid];

  const episode = { user: { name, role: 'software_developer' } };
  const addParams = {
    name: `User: ${name}`,
    episode_body: JSON.stringify(episode),
    source: 'json',
    group_id: groupId || DEFAULT_GROUP_ID,
  };
  const [, sid2] = await rpcCall('add_memory', addParams, sid);
  const [resp2, sid3] = await rpcCall('search_nodes', searchParams, sid2);
  const nodes2 = resp2?.result?.nodes || resp2?.nodes;
  return [nodes2 && nodes2.length ? nodes2[0].uuid : null, sid3];
}

async function recordUserWork({
  project,
  repository,
  groupId = null,
  sessionId = null,
}: {
  project?: string | null;
  repository?: string | null;
  groupId?: string | null;
  sessionId?: string | null;
}): Promise<string | null> {
  const user = getUserName();
  const targets = [];
  if (project) targets.push(`project ${project}`);
  if (repository) targets.push(`repository ${repository}`);
  if (!targets.length) return sessionId;
  const text = `${user} is working on ${targets.join(' and ')}`;
  const params = {
    name: `Work context: ${user}`,
    episode_body: text,
    source: 'text',
    group_id: groupId || DEFAULT_GROUP_ID,
  };
  const [, sid] = await rpcCall('add_memory', params, sessionId);
  return sid;
}

module.exports = { getUserName, ensureUser, recordUserWork };
