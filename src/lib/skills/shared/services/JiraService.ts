/**
 * Jira service - encapsulates all Jira REST API operations.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface IJiraConfig {
  endpoint: string;
  user: string;
  token: string;
}

export interface IJiraUser {
  accountId: string;
  displayName?: string;
}

interface IJiraIssueFields {
  project?: { key: string };
  summary?: string;
  issuetype?: { id: string; name?: string };
  description?: IAdfDocument;
  parent?: { key: string };
  assignee?: { accountId: string };
  status?: { name: string };
  reporter?: { displayName: string };
  created?: string;
  updated?: string;
  subtasks?: Array<{
    key: string;
    fields: { summary: string; status?: { name: string } };
  }>;
}

interface IJiraIssue {
  key: string;
  fields: IJiraIssueFields;
}

interface IJiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

interface IAdfDocument {
  type: 'doc';
  version: 1;
  content: Array<{
    type: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
}

export interface ICreateIssueArgs {
  type: string;
  project: string;
  summary: string;
  description?: string;
  parent?: string;
  assign?: string;
}

export interface IListIssuesArgs {
  project?: string;
  jql?: string;
  mine?: boolean;
  limit?: number;
}

export interface IAssignIssueArgs {
  to: string;
}

export interface ITransitionIssueArgs {
  to: string;
}

export interface IChangeTypeArgs {
  to: string;
}

// Standard issue type IDs (Jira Cloud defaults)
const ISSUE_TYPES: Record<string, string> = {
  epic: '10000',
  story: '10001',
  task: '10002',
  subtask: '10003',
  bug: '10004',
};

// ============================================================================
// Jira Client
// ============================================================================

export interface IJiraClient {
  getCurrentUser(): Promise<IJiraUser>;
  createIssue(args: ICreateIssueArgs): Promise<{ key: string; url: string; summary: string; type: string }>;
  listIssues(args: IListIssuesArgs): Promise<{ issues: Array<Record<string, string>>; total: number }>;
  viewIssue(issueKey: string): Promise<Record<string, unknown>>;
  assignIssue(issueKey: string, args: IAssignIssueArgs): Promise<{ issue: string; assignee: string }>;
  transitionIssue(issueKey: string, args: ITransitionIssueArgs): Promise<{ issue: string; from: string; to: string }>;
  changeIssueType(issueKey: string, args: IChangeTypeArgs): Promise<{ key: string; url: string; previousType: string; newType: string }>;
}

/**
 * Convert plain text to Atlassian Document Format.
 */
function textToAdf(text: string): IAdfDocument | undefined {
  if (!text) return undefined;
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

/**
 * Creates a Jira client instance.
 */
export function createJiraClient(config: IJiraConfig): IJiraClient {
  const { endpoint, user, token } = config;

  async function jiraFetch<T>(urlPath: string, options: RequestInit = {}): Promise<T> {
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
      const errorMsg = errData.errorMessages?.join(', ') || 
        (errData.errors ? JSON.stringify(errData.errors) : `HTTP ${response.status}`);
      throw new Error(errorMsg);
    }

    return data as T;
  }

  return {
    async getCurrentUser(): Promise<IJiraUser> {
      return jiraFetch<IJiraUser>('/myself');
    },

    async createIssue(args: ICreateIssueArgs) {
      const { type, project, summary, description, parent, assign } = args;

      const issueTypeId = ISSUE_TYPES[type.toLowerCase()];
      if (!issueTypeId) throw new Error(`Unknown issue type: ${type}`);

      const fields: IJiraIssueFields = {
        project: { key: project },
        summary,
        issuetype: { id: issueTypeId },
      };

      if (description) {
        fields.description = textToAdf(description);
      }

      if (parent) {
        fields.parent = { key: parent };
      }

      if (assign) {
        if (assign === 'me') {
          const me = await this.getCurrentUser();
          fields.assignee = { accountId: me.accountId };
        } else {
          const users = await jiraFetch<IJiraUser[]>(`/user/search?query=${encodeURIComponent(assign)}`);
          if (users.length === 0) throw new Error(`User not found: ${assign}`);
          fields.assignee = { accountId: users[0].accountId };
        }
      }

      const data = await jiraFetch<{ key: string }>('/issue', {
        method: 'POST',
        body: JSON.stringify({ fields }),
      });

      return {
        key: data.key,
        url: `${endpoint}/browse/${data.key}`,
        summary,
        type,
      };
    },

    async listIssues(args: IListIssuesArgs) {
      const { project, jql, mine, limit = 20 } = args;

      let query = jql;
      if (!query) {
        const conditions: string[] = [];
        if (project) conditions.push(`project = ${project}`);
        if (mine) conditions.push('assignee = currentUser()');
        if (conditions.length === 0) conditions.push('assignee = currentUser()');
        query = conditions.join(' AND ') + ' ORDER BY created DESC';
      }

      const data = await jiraFetch<{ issues?: IJiraIssue[]; total?: number }>('/search/jql', {
        method: 'POST',
        body: JSON.stringify({
          jql: query,
          maxResults: limit,
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

      return { issues, total: data.total || issues.length };
    },

    async viewIssue(issueKey: string) {
      const data = await jiraFetch<IJiraIssue>(
        `/issue/${issueKey}?fields=summary,description,status,assignee,reporter,created,updated,issuetype,parent,subtasks`
      );

      let descriptionText = '';
      if (data.fields.description?.content) {
        descriptionText = data.fields.description.content
          .filter((block) => block.type === 'paragraph')
          .map((block) => block.content?.map((c) => c.text).join('') || '')
          .join('\n');
      }

      return {
        key: data.key,
        url: `${endpoint}/browse/${data.key}`,
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
      };
    },

    async assignIssue(issueKey: string, args: IAssignIssueArgs) {
      let accountId: string;

      if (args.to === 'me') {
        const me = await this.getCurrentUser();
        accountId = me.accountId;
      } else {
        const users = await jiraFetch<IJiraUser[]>(`/user/search?query=${encodeURIComponent(args.to)}`);
        if (users.length === 0) throw new Error(`User not found: ${args.to}`);
        accountId = users[0].accountId;
      }

      await jiraFetch<void>(`/issue/${issueKey}/assignee`, {
        method: 'PUT',
        body: JSON.stringify({ accountId }),
      });

      return { issue: issueKey, assignee: args.to };
    },

    async transitionIssue(issueKey: string, args: ITransitionIssueArgs) {
      const transitions = await jiraFetch<{ transitions?: IJiraTransition[] }>(`/issue/${issueKey}/transitions`);

      const targetStatus = args.to.toLowerCase();
      const transition = transitions.transitions?.find(
        (t) => t.name.toLowerCase() === targetStatus || t.to.name.toLowerCase() === targetStatus
      );

      if (!transition) {
        const available = transitions.transitions?.map((t) => t.name).join(', ') || 'none';
        throw new Error(`Transition "${args.to}" not found. Available: ${available}`);
      }

      await jiraFetch<void>(`/issue/${issueKey}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: transition.id } }),
      });

      return { issue: issueKey, from: transition.name, to: transition.to.name };
    },

    async changeIssueType(issueKey: string, args: IChangeTypeArgs) {
      const targetType = args.to.toLowerCase();
      const typeId = ISSUE_TYPES[targetType];
      if (!typeId) {
        throw new Error(`Unknown type: ${args.to}. Valid: ${Object.keys(ISSUE_TYPES).join(', ')}`);
      }

      const currentIssue = await jiraFetch<IJiraIssue>(`/issue/${issueKey}`);
      const currentType = currentIssue.fields.issuetype?.name || '';

      await jiraFetch<void>(`/issue/${issueKey}`, {
        method: 'PUT',
        body: JSON.stringify({ fields: { issuetype: { id: typeId } } }),
      });

      return {
        key: issueKey,
        url: `${endpoint}/browse/${issueKey}`,
        previousType: currentType,
        newType: args.to,
      };
    },
  };
}

// ============================================================================
// Config Loader
// ============================================================================

const JIRA_CONFIG_DIR = path.join(os.homedir(), '.jira.d');
const CONFIG_FILE = path.join(JIRA_CONFIG_DIR, 'config.yml');
const TOKEN_FILE = path.join(JIRA_CONFIG_DIR, 'api-token');

/**
 * Load Jira configuration from ~/.jira.d/
 */
export function loadJiraConfig(): IJiraConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`Config not found: ${CONFIG_FILE}. Run setup first.`);
  }

  const configText = fs.readFileSync(CONFIG_FILE, 'utf8');
  const config: Record<string, string> = {};

  configText.split('\n').forEach((line: string) => {
    const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (match) {
      config[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  });

  if (!config.endpoint) throw new Error('Missing endpoint in config.yml');
  if (!config.user) throw new Error('Missing user in config.yml');

  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(`Token not found: ${TOKEN_FILE}. Create file with your API token.`);
  }
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();

  return { endpoint: config.endpoint, user: config.user, token };
}
