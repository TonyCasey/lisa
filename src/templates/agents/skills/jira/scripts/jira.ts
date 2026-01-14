#!/usr/bin/env node
export {}; // ensure module scope to prevent global collisions

/**
 * Model-neutral Jira helper using Atlassian REST API v3.
 *
 * Commands:
 *   node jira.js create --type <type> --project <key> --summary "..." [--description "..."] [--parent KEY] [--assign me]
 *   node jira.js list [--project <key>] [--jql "..."] [--mine] [--limit N]
 *   node jira.js view <issue-key>
 *   node jira.js assign <issue-key> --to <user|me>
 *   node jira.js transition <issue-key> --to "Status Name"
 *   node jira.js change-type <issue-key> --to <epic|story|task|subtask|bug>
 *
 * Configuration:
 *   ~/.jira.d/config.yml - endpoint, user
 *   ~/.jira.d/api-token  - raw API token
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================================
// Types
// ============================================================================

interface JiraConfig {
  endpoint: string;
  user: string;
  [key: string]: string;
}

interface JiraUser {
  accountId: string;
  displayName?: string;
}

interface JiraIssueFields {
  project?: { key: string };
  summary?: string;
  issuetype?: { id: string; name?: string };
  description?: AdfDocument;
  parent?: { key: string };
  assignee?: { accountId: string };
  status?: { name: string };
  reporter?: { displayName: string };
  created?: string;
  updated?: string;
  subtasks?: Array<{
    key: string;
    fields: {
      summary: string;
      status?: { name: string };
    };
  }>;
}

interface JiraIssue {
  key: string;
  fields: JiraIssueFields;
}

interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

interface AdfDocument {
  type: 'doc';
  version: 1;
  content: Array<{
    type: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
}

interface CreateArgs {
  type?: string;
  project?: string;
  summary?: string;
  description?: string;
  parent?: string;
  assign?: string;
}

interface ListArgs {
  project?: string;
  jql?: string;
  mine?: boolean;
  limit?: string | number;
}

interface AssignArgs {
  to?: string;
}

interface TransitionArgs {
  to?: string;
}

interface ChangeTypeArgs {
  to?: string;
}

interface ParsedArgs {
  command: string | null;
  args: Record<string, string | boolean>;
  positional: string[];
}

// ============================================================================
// Configuration
// ============================================================================

const JIRA_CONFIG_DIR = path.join(os.homedir(), '.jira.d');
const CONFIG_FILE = path.join(JIRA_CONFIG_DIR, 'config.yml');
const TOKEN_FILE = path.join(JIRA_CONFIG_DIR, 'api-token');

// Issue type IDs (standard Jira Cloud defaults)
const ISSUE_TYPES: Record<string, string> = {
  epic: '10000',
  story: '10001',
  task: '10002',
  subtask: '10003',
  bug: '10004',
};

function loadConfig(): JiraConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`Config not found: ${CONFIG_FILE}. Run setup first.`);
  }

  const configText = fs.readFileSync(CONFIG_FILE, 'utf8');
  const config: Record<string, string> = {};

  // Simple YAML parsing for key: value format
  configText.split('\n').forEach((line: string) => {
    const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (match) {
      config[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  });

  if (!config.endpoint) throw new Error('Missing endpoint in config.yml');
  if (!config.user) throw new Error('Missing user in config.yml');

  return config as JiraConfig;
}

function loadToken(): string {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(`Token not found: ${TOKEN_FILE}. Create file with your API token.`);
  }
  return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
}

// ============================================================================
// API Client
// ============================================================================

async function jiraFetch<T>(
  endpoint: string,
  user: string,
  token: string,
  urlPath: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${endpoint}/rest/api/3${urlPath}`;
  const auth = Buffer.from(`${user}:${token}`).toString('base64');

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data: T | { errorMessages?: string[]; errors?: Record<string, string> };

  try {
    data = text ? JSON.parse(text) : ({} as T);
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    const errData = data as { errorMessages?: string[]; errors?: Record<string, string> };
    const errorMsg =
      errData.errorMessages?.join(', ') || (errData.errors ? JSON.stringify(errData.errors) : `HTTP ${response.status}`);
    throw new Error(errorMsg);
  }

  return data as T;
}

// ============================================================================
// Atlassian Document Format (ADF) Helper
// ============================================================================

function textToAdf(text: string): AdfDocument | undefined {
  if (!text) return undefined;

  // Simple conversion: split by newlines, create paragraphs
  const paragraphs = text.split('\n').filter((p) => p.trim());

  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map((p) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p }],
    })),
  };
}

// ============================================================================
// Commands
// ============================================================================

async function getCurrentUser(endpoint: string, user: string, token: string): Promise<JiraUser> {
  const data = await jiraFetch<JiraUser>(endpoint, user, token, '/myself');
  return data;
}

async function createIssue(
  config: JiraConfig,
  token: string,
  args: CreateArgs
): Promise<{ status: string; action: string; issue: Record<string, string> }> {
  const { type, project, summary, description, parent, assign } = args;

  if (!type) throw new Error('--type required (epic, story, task, subtask, bug)');
  if (!project) throw new Error('--project required');
  if (!summary) throw new Error('--summary required');

  const issueTypeId = ISSUE_TYPES[type.toLowerCase()];
  if (!issueTypeId) throw new Error(`Unknown issue type: ${type}`);

  const fields: JiraIssueFields = {
    project: { key: project },
    summary: summary,
    issuetype: { id: issueTypeId },
  };

  if (description) {
    fields.description = textToAdf(description);
  }

  // Link to parent for sub-tasks
  if (parent) {
    fields.parent = { key: parent };
  }

  // Assign to user
  if (assign) {
    if (assign === 'me') {
      const me = await getCurrentUser(config.endpoint, config.user, token);
      fields.assignee = { accountId: me.accountId };
    } else {
      // Search for user by email
      const users = await jiraFetch<JiraUser[]>(
        config.endpoint,
        config.user,
        token,
        `/user/search?query=${encodeURIComponent(assign)}`
      );
      if (users.length === 0) throw new Error(`User not found: ${assign}`);
      fields.assignee = { accountId: users[0].accountId };
    }
  }

  const data = await jiraFetch<{ key: string }>(config.endpoint, config.user, token, '/issue', {
    method: 'POST',
    body: JSON.stringify({ fields }),
  });

  return {
    status: 'ok',
    action: 'create',
    issue: {
      key: data.key,
      url: `${config.endpoint}/browse/${data.key}`,
      summary: summary,
      type: type,
    },
  };
}

async function listIssues(
  config: JiraConfig,
  token: string,
  args: ListArgs
): Promise<{ status: string; action: string; issues: Array<Record<string, string>>; total: number }> {
  const { project, jql, mine, limit = 20 } = args;

  let query = jql;

  if (!query) {
    const conditions: string[] = [];
    if (project) conditions.push(`project = ${project}`);
    if (mine) conditions.push('assignee = currentUser()');
    if (conditions.length === 0) conditions.push('assignee = currentUser()');
    query = conditions.join(' AND ') + ' ORDER BY created DESC';
  }

  const data = await jiraFetch<{ issues?: JiraIssue[]; total?: number }>(config.endpoint, config.user, token, '/search/jql', {
    method: 'POST',
    body: JSON.stringify({
      jql: query,
      maxResults: parseInt(String(limit)),
      fields: ['summary', 'status', 'assignee', 'issuetype', 'parent'],
    }),
  });

  const issues = (data.issues || []).map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary || '',
    status: issue.fields.status?.name || '',
    assignee: issue.fields.assignee?.accountId ? 'Assigned' : 'Unassigned',
    type: issue.fields.issuetype?.name || '',
    parent: issue.fields.parent?.key || '',
  }));

  return {
    status: 'ok',
    action: 'list',
    issues: issues,
    total: data.total || issues.length,
  };
}

async function viewIssue(
  config: JiraConfig,
  token: string,
  issueKey: string
): Promise<{ status: string; action: string; issue: Record<string, unknown> }> {
  if (!issueKey) throw new Error('Issue key required');

  const data = await jiraFetch<JiraIssue>(
    config.endpoint,
    config.user,
    token,
    `/issue/${issueKey}?fields=summary,description,status,assignee,reporter,created,updated,issuetype,parent,subtasks`
  );

  // Extract text from ADF description
  let descriptionText = '';
  if (data.fields.description?.content) {
    descriptionText = data.fields.description.content
      .filter((block) => block.type === 'paragraph')
      .map((block) => block.content?.map((c) => c.text).join('') || '')
      .join('\n');
  }

  return {
    status: 'ok',
    action: 'view',
    issue: {
      key: data.key,
      url: `${config.endpoint}/browse/${data.key}`,
      summary: data.fields.summary || '',
      description: descriptionText,
      status: data.fields.status?.name || '',
      assignee: data.fields.assignee?.accountId ? 'Assigned' : 'Unassigned',
      reporter: data.fields.reporter?.displayName || '',
      type: data.fields.issuetype?.name || '',
      parent: data.fields.parent?.key || '',
      created: data.fields.created || '',
      updated: data.fields.updated || '',
      subtasks: (data.fields.subtasks || []).map((st) => ({
        key: st.key,
        summary: st.fields.summary,
        status: st.fields.status?.name || '',
      })),
    },
  };
}

async function assignIssue(
  config: JiraConfig,
  token: string,
  issueKey: string,
  args: AssignArgs
): Promise<{ status: string; action: string; issue: string; assignee: string }> {
  if (!issueKey) throw new Error('Issue key required');
  if (!args.to) throw new Error('--to required (user email or "me")');

  let accountId: string;

  if (args.to === 'me') {
    const me = await getCurrentUser(config.endpoint, config.user, token);
    accountId = me.accountId;
  } else {
    const users = await jiraFetch<JiraUser[]>(
      config.endpoint,
      config.user,
      token,
      `/user/search?query=${encodeURIComponent(args.to)}`
    );
    if (users.length === 0) throw new Error(`User not found: ${args.to}`);
    accountId = users[0].accountId;
  }

  await jiraFetch<void>(config.endpoint, config.user, token, `/issue/${issueKey}/assignee`, {
    method: 'PUT',
    body: JSON.stringify({ accountId }),
  });

  return {
    status: 'ok',
    action: 'assign',
    issue: issueKey,
    assignee: args.to,
  };
}

async function transitionIssue(
  config: JiraConfig,
  token: string,
  issueKey: string,
  args: TransitionArgs
): Promise<{ status: string; action: string; issue: string; from: string; to: string }> {
  if (!issueKey) throw new Error('Issue key required');
  if (!args.to) throw new Error('--to required (status name)');

  // Get available transitions
  const transitions = await jiraFetch<{ transitions?: JiraTransition[] }>(
    config.endpoint,
    config.user,
    token,
    `/issue/${issueKey}/transitions`
  );

  const targetStatus = args.to.toLowerCase();
  const transition = transitions.transitions?.find(
    (t) => t.name.toLowerCase() === targetStatus || t.to.name.toLowerCase() === targetStatus
  );

  if (!transition) {
    const available = transitions.transitions?.map((t) => t.name).join(', ') || 'none';
    throw new Error(`Transition "${args.to}" not found. Available: ${available}`);
  }

  await jiraFetch<void>(config.endpoint, config.user, token, `/issue/${issueKey}/transitions`, {
    method: 'POST',
    body: JSON.stringify({ transition: { id: transition.id } }),
  });

  return {
    status: 'ok',
    action: 'transition',
    issue: issueKey,
    from: transition.name,
    to: transition.to.name,
  };
}

async function changeIssueType(
  config: JiraConfig,
  token: string,
  issueKey: string,
  args: ChangeTypeArgs
): Promise<{ status: string; action: string; issue: Record<string, string> }> {
  if (!issueKey) throw new Error('Issue key required');
  if (!args.to) throw new Error('--to required (type name: epic, story, task, subtask, bug)');

  const targetType = args.to.toLowerCase();
  const typeId = ISSUE_TYPES[targetType];
  if (!typeId) {
    throw new Error(`Unknown type: ${args.to}. Valid types: ${Object.keys(ISSUE_TYPES).join(', ')}`);
  }

  // Get current issue to show before/after
  const currentIssue = await jiraFetch<JiraIssue>(config.endpoint, config.user, token, `/issue/${issueKey}`);
  const currentType = currentIssue.fields.issuetype?.name || '';

  // Change the issue type
  await jiraFetch<void>(config.endpoint, config.user, token, `/issue/${issueKey}`, {
    method: 'PUT',
    body: JSON.stringify({
      fields: {
        issuetype: { id: typeId },
      },
    }),
  });

  return {
    status: 'ok',
    action: 'change-type',
    issue: {
      key: issueKey,
      url: `${config.endpoint}/browse/${issueKey}`,
      previousType: currentType,
      newType: args.to,
    },
  };
}

// ============================================================================
// CLI Parser
// ============================================================================

function parseArgs(argv: string[]): ParsedArgs {
  const args: Record<string, string | boolean> = {};
  let command: string | null = null;
  const positional: string[] = [];

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, args, positional };
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  try {
    const { command, args, positional } = parseArgs(process.argv);

    if (!command) {
      console.log(
        JSON.stringify({
          status: 'error',
          error: 'No command specified',
          usage: 'jira.js <create|list|view|assign|transition|change-type> [options]',
        })
      );
      process.exit(1);
    }

    const config = loadConfig();
    const token = loadToken();

    let result: Record<string, unknown>;

    switch (command) {
      case 'create':
        result = await createIssue(config, token, args as unknown as CreateArgs);
        break;
      case 'list':
        result = await listIssues(config, token, args as unknown as ListArgs);
        break;
      case 'view':
        result = await viewIssue(config, token, positional[0] || (args.issue as string));
        break;
      case 'assign':
        result = await assignIssue(config, token, positional[0] || (args.issue as string), args as unknown as AssignArgs);
        break;
      case 'transition':
        result = await transitionIssue(config, token, positional[0] || (args.issue as string), args as unknown as TransitionArgs);
        break;
      case 'change-type':
        result = await changeIssueType(config, token, positional[0] || (args.issue as string), args as unknown as ChangeTypeArgs);
        break;
      default:
        result = {
          status: 'error',
          error: `Unknown command: ${command}`,
          available: ['create', 'list', 'view', 'assign', 'transition', 'change-type'],
        };
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      JSON.stringify({
        status: 'error',
        error: message,
      })
    );
    process.exit(1);
  }
}

main();
