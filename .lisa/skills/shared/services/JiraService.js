"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJiraClient = createJiraClient;
exports.loadJiraConfig = loadJiraConfig;
/**
 * Jira service - encapsulates all Jira REST API operations.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
// Standard issue type IDs (Jira Cloud defaults)
const ISSUE_TYPES = {
    epic: '10000',
    story: '10001',
    task: '10002',
    subtask: '10003',
    bug: '10004',
};
/**
 * Convert plain text to Atlassian Document Format.
 */
function textToAdf(text) {
    if (!text)
        return undefined;
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
function createJiraClient(config) {
    const { endpoint, user, token } = config;
    async function jiraFetch(urlPath, options = {}) {
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
        let data;
        try {
            data = text ? JSON.parse(text) : {};
        }
        catch {
            throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
        }
        if (!response.ok) {
            const errData = data;
            const errorMsg = errData.errorMessages?.join(', ') ||
                (errData.errors ? JSON.stringify(errData.errors) : `HTTP ${response.status}`);
            throw new Error(errorMsg);
        }
        return data;
    }
    return {
        async getCurrentUser() {
            return jiraFetch('/myself');
        },
        async createIssue(args) {
            const { type, project, summary, description, parent, assign } = args;
            const issueTypeId = ISSUE_TYPES[type.toLowerCase()];
            if (!issueTypeId)
                throw new Error(`Unknown issue type: ${type}`);
            const fields = {
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
                }
                else {
                    const users = await jiraFetch(`/user/search?query=${encodeURIComponent(assign)}`);
                    if (users.length === 0)
                        throw new Error(`User not found: ${assign}`);
                    fields.assignee = { accountId: users[0].accountId };
                }
            }
            const data = await jiraFetch('/issue', {
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
        async listIssues(args) {
            const { project, jql, mine, limit = 20 } = args;
            let query = jql;
            if (!query) {
                const conditions = [];
                if (project)
                    conditions.push(`project = ${project}`);
                if (mine)
                    conditions.push('assignee = currentUser()');
                if (conditions.length === 0)
                    conditions.push('assignee = currentUser()');
                query = conditions.join(' AND ') + ' ORDER BY created DESC';
            }
            const data = await jiraFetch('/search/jql', {
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
        async viewIssue(issueKey) {
            const data = await jiraFetch(`/issue/${issueKey}?fields=summary,description,status,assignee,reporter,created,updated,issuetype,parent,subtasks`);
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
        async assignIssue(issueKey, args) {
            let accountId;
            if (args.to === 'me') {
                const me = await this.getCurrentUser();
                accountId = me.accountId;
            }
            else {
                const users = await jiraFetch(`/user/search?query=${encodeURIComponent(args.to)}`);
                if (users.length === 0)
                    throw new Error(`User not found: ${args.to}`);
                accountId = users[0].accountId;
            }
            await jiraFetch(`/issue/${issueKey}/assignee`, {
                method: 'PUT',
                body: JSON.stringify({ accountId }),
            });
            return { issue: issueKey, assignee: args.to };
        },
        async transitionIssue(issueKey, args) {
            const transitions = await jiraFetch(`/issue/${issueKey}/transitions`);
            const targetStatus = args.to.toLowerCase();
            const transition = transitions.transitions?.find((t) => t.name.toLowerCase() === targetStatus || t.to.name.toLowerCase() === targetStatus);
            if (!transition) {
                const available = transitions.transitions?.map((t) => t.name).join(', ') || 'none';
                throw new Error(`Transition "${args.to}" not found. Available: ${available}`);
            }
            await jiraFetch(`/issue/${issueKey}/transitions`, {
                method: 'POST',
                body: JSON.stringify({ transition: { id: transition.id } }),
            });
            return { issue: issueKey, from: transition.name, to: transition.to.name };
        },
        async changeIssueType(issueKey, args) {
            const targetType = args.to.toLowerCase();
            const typeId = ISSUE_TYPES[targetType];
            if (!typeId) {
                throw new Error(`Unknown type: ${args.to}. Valid: ${Object.keys(ISSUE_TYPES).join(', ')}`);
            }
            const currentIssue = await jiraFetch(`/issue/${issueKey}`);
            const currentType = currentIssue.fields.issuetype?.name || '';
            await jiraFetch(`/issue/${issueKey}`, {
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
const JIRA_CONFIG_DIR = path_1.default.join(os_1.default.homedir(), '.jira.d');
const CONFIG_FILE = path_1.default.join(JIRA_CONFIG_DIR, 'config.yml');
const TOKEN_FILE = path_1.default.join(JIRA_CONFIG_DIR, 'api-token');
/**
 * Load Jira configuration from ~/.jira.d/
 */
function loadJiraConfig() {
    if (!fs_1.default.existsSync(CONFIG_FILE)) {
        throw new Error(`Config not found: ${CONFIG_FILE}. Run setup first.`);
    }
    const configText = fs_1.default.readFileSync(CONFIG_FILE, 'utf8');
    const config = {};
    configText.split('\n').forEach((line) => {
        const match = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
        if (match) {
            config[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
        }
    });
    if (!config.endpoint)
        throw new Error('Missing endpoint in config.yml');
    if (!config.user)
        throw new Error('Missing user in config.yml');
    if (!fs_1.default.existsSync(TOKEN_FILE)) {
        throw new Error(`Token not found: ${TOKEN_FILE}. Create file with your API token.`);
    }
    const token = fs_1.default.readFileSync(TOKEN_FILE, 'utf8').trim();
    return { endpoint: config.endpoint, user: config.user, token };
}
//# sourceMappingURL=JiraService.js.map