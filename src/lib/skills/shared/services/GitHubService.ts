/**
 * GitHub service - encapsulates GitHub Issues and Projects v2 operations.
 * Uses gh CLI wrapper for API calls.
 */
import type { IGhCliClient } from '../clients/interfaces';

// ============================================================================
// Types - Issues
// ============================================================================

export interface IGitHubIssue {
  number: number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  url: string;
  createdAt: string;
  updatedAt: string;
  author?: string;
  milestone?: string;
}

export interface ICreateIssueArgs {
  repo: string;
  title: string;
  body?: string;
  labels?: string[];
  assignee?: string;
  milestone?: string;
}

export interface IListIssuesArgs {
  repo: string;
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  assignee?: string;
  author?: string;
  milestone?: string;
  limit?: number;
}

export interface IViewIssueArgs {
  repo: string;
  number: number;
}

export interface ICloseIssueArgs {
  repo: string;
  number: number;
  reason?: 'completed' | 'not_planned';
}

export interface IReopenIssueArgs {
  repo: string;
  number: number;
}

export interface IAssignIssueArgs {
  repo: string;
  number: number;
  assignees: string[];
}

export interface ILabelIssueArgs {
  repo: string;
  number: number;
  add?: string[];
  remove?: string[];
}

// ============================================================================
// Types - Projects v2
// ============================================================================

export interface IGitHubProject {
  id: string;
  number: number;
  title: string;
  url: string;
  closed: boolean;
  shortDescription?: string;
}

export interface IGitHubProjectField {
  id: string;
  name: string;
  dataType: string;
  options?: Array<{ id: string; name: string }>;
}

export interface IGitHubProjectItem {
  id: string;
  type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE';
  content?: {
    number?: number;
    title: string;
    url?: string;
    state?: string;
  };
  fieldValues: Record<string, string>;
}

export interface IListProjectsArgs {
  repo: string;
  limit?: number;
}

export interface IGetProjectArgs {
  repo: string;
  number: number;
}

export interface IGetProjectItemsArgs {
  repo: string;
  projectNumber: number;
  limit?: number;
}

export interface IGetProjectFieldsArgs {
  repo: string;
  projectNumber: number;
}

export interface IAddToProjectArgs {
  repo: string;
  projectNumber: number;
  issueNumber: number;
}

export interface ISetProjectFieldArgs {
  repo: string;
  projectNumber: number;
  itemId: string;
  fieldName: string;
  value: string;
}

// ============================================================================
// GitHub Client Interface
// ============================================================================

export interface IGitHubClient {
  // Issues
  createIssue(args: ICreateIssueArgs): Promise<{ number: number; url: string; title: string }>;
  listIssues(args: IListIssuesArgs): Promise<{ issues: IGitHubIssue[]; total: number }>;
  viewIssue(args: IViewIssueArgs): Promise<IGitHubIssue>;
  closeIssue(args: ICloseIssueArgs): Promise<{ number: number; state: string }>;
  reopenIssue(args: IReopenIssueArgs): Promise<{ number: number; state: string }>;
  assignIssue(args: IAssignIssueArgs): Promise<{ number: number; assignees: string[] }>;
  labelIssue(args: ILabelIssueArgs): Promise<{ number: number; labels: string[] }>;

  // Projects v2
  listProjects(args: IListProjectsArgs): Promise<{ projects: IGitHubProject[]; total: number }>;
  getProject(args: IGetProjectArgs): Promise<IGitHubProject>;
  getProjectItems(args: IGetProjectItemsArgs): Promise<{ items: IGitHubProjectItem[]; total: number }>;
  getProjectFields(args: IGetProjectFieldsArgs): Promise<{ fields: IGitHubProjectField[] }>;
  addToProject(args: IAddToProjectArgs): Promise<{ itemId: string }>;
  setProjectField(args: ISetProjectFieldArgs): Promise<{ itemId: string; field: string; value: string }>;
}

// ============================================================================
// gh CLI response types (internal)
// ============================================================================

interface GhIssueResponse {
  number: number;
  title: string;
  body?: string;
  state: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  url: string;
  createdAt: string;
  updatedAt: string;
  author?: { login: string };
  milestone?: { title: string };
}

// ============================================================================
// GraphQL Queries
// ============================================================================

const GRAPHQL_LIST_PROJECTS = `
query($owner: String!, $repo: String!, $first: Int!) {
  repository(owner: $owner, name: $repo) {
    projectsV2(first: $first) {
      totalCount
      nodes {
        id
        number
        title
        url
        closed
        shortDescription
      }
    }
  }
}
`;

const GRAPHQL_GET_PROJECT = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    projectV2(number: $number) {
      id
      number
      title
      url
      closed
      shortDescription
    }
  }
}
`;

const GRAPHQL_GET_PROJECT_FIELDS = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    projectV2(number: $number) {
      id
      fields(first: 50) {
        nodes {
          ... on ProjectV2Field {
            id
            name
            dataType
          }
          ... on ProjectV2SingleSelectField {
            id
            name
            dataType
            options {
              id
              name
            }
          }
          ... on ProjectV2IterationField {
            id
            name
            dataType
          }
        }
      }
    }
  }
}
`;

const GRAPHQL_GET_PROJECT_ITEMS = `
query($owner: String!, $repo: String!, $number: Int!, $first: Int!) {
  repository(owner: $owner, name: $repo) {
    projectV2(number: $number) {
      items(first: $first) {
        totalCount
        nodes {
          id
          type
          content {
            ... on Issue {
              number
              title
              url
              state
            }
            ... on PullRequest {
              number
              title
              url
              state
            }
            ... on DraftIssue {
              title
            }
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldTextValue {
                text
                field { ... on ProjectV2Field { name } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field { ... on ProjectV2Field { name } }
              }
              ... on ProjectV2ItemFieldDateValue {
                date
                field { ... on ProjectV2Field { name } }
              }
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { name } }
              }
              ... on ProjectV2ItemFieldIterationValue {
                title
                field { ... on ProjectV2IterationField { name } }
              }
            }
          }
        }
      }
    }
  }
}
`;

const GRAPHQL_GET_PROJECT_ID = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    projectV2(number: $number) {
      id
    }
  }
}
`;

const GRAPHQL_GET_ISSUE_ID = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id
    }
  }
}
`;

const GRAPHQL_ADD_TO_PROJECT = `
mutation($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
    item {
      id
    }
  }
}
`;

// Note: GraphQL mutation for updating project fields is not used directly
// because gh api graphql doesn't handle ProjectV2FieldValue input type well.
// We use `gh project item-edit` CLI command instead.

// ============================================================================
// Helper Functions
// ============================================================================

function parseRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid repo format: ${repo}. Expected "owner/repo".`);
  }
  return { owner: parts[0], name: parts[1] };
}

function mapGhIssue(issue: GhIssueResponse): IGitHubIssue {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state.toLowerCase() as 'open' | 'closed',
    labels: issue.labels?.map((l) => l.name) ?? [],
    assignees: issue.assignees?.map((a) => a.login) ?? [],
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    author: issue.author?.login,
    milestone: issue.milestone?.title,
  };
}

// ============================================================================
// GitHub Client Implementation
// ============================================================================

/**
 * Creates a GitHub client instance.
 */
export function createGitHubClient(ghCli: IGhCliClient): IGitHubClient {
  return {
    // ========================================================================
    // Issues
    // ========================================================================

    async createIssue(args: ICreateIssueArgs) {
      const cmdArgs = ['issue', 'create', '--repo', args.repo, '--title', args.title];

      if (args.body) {
        cmdArgs.push('--body', args.body);
      }
      if (args.labels?.length) {
        cmdArgs.push('--label', args.labels.join(','));
      }
      if (args.assignee) {
        cmdArgs.push('--assignee', args.assignee);
      }
      if (args.milestone) {
        cmdArgs.push('--milestone', args.milestone);
      }

      const result = await ghCli.run<{ number: number; url: string }>(cmdArgs);

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create issue');
      }

      // gh issue create returns URL, parse number from it
      const raw = result.data as { raw?: string; number?: number; url?: string };
      let number: number;
      let url: string;

      if (raw.number && raw.url) {
        number = raw.number;
        url = raw.url;
      } else if (raw.raw) {
        // Parse from raw output: "https://github.com/owner/repo/issues/123"
        const match = raw.raw.match(/\/issues\/(\d+)/);
        if (!match) {
          throw new Error(`Failed to parse issue number from response: ${raw.raw}`);
        }
        number = parseInt(match[1], 10);
        url = raw.raw.trim();
      } else {
        throw new Error('Unexpected response format from gh issue create');
      }

      return { number, url, title: args.title };
    },

    async listIssues(args: IListIssuesArgs) {
      const cmdArgs = [
        'issue', 'list',
        '--repo', args.repo,
        '--json', 'number,title,body,state,labels,assignees,url,createdAt,updatedAt,author,milestone',
      ];

      if (args.state && args.state !== 'all') {
        cmdArgs.push('--state', args.state);
      } else if (args.state === 'all') {
        cmdArgs.push('--state', 'all');
      }
      if (args.labels?.length) {
        cmdArgs.push('--label', args.labels.join(','));
      }
      if (args.assignee) {
        cmdArgs.push('--assignee', args.assignee);
      }
      if (args.author) {
        cmdArgs.push('--author', args.author);
      }
      if (args.milestone) {
        cmdArgs.push('--milestone', args.milestone);
      }
      if (args.limit) {
        cmdArgs.push('--limit', String(args.limit));
      }

      const result = await ghCli.run<GhIssueResponse[]>(cmdArgs);

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to list issues');
      }

      const issues = (result.data ?? []).map(mapGhIssue);
      return { issues, total: issues.length };
    },

    async viewIssue(args: IViewIssueArgs) {
      const cmdArgs = [
        'issue', 'view',
        '--repo', args.repo,
        String(args.number),
        '--json', 'number,title,body,state,labels,assignees,url,createdAt,updatedAt,author,milestone',
      ];

      const result = await ghCli.run<GhIssueResponse>(cmdArgs);

      if (!result.success) {
        throw new Error(result.error ?? `Failed to view issue #${args.number}`);
      }

      if (!result.data) {
        throw new Error(`Issue #${args.number} not found`);
      }

      return mapGhIssue(result.data);
    },

    async closeIssue(args: ICloseIssueArgs) {
      const cmdArgs = ['issue', 'close', '--repo', args.repo, String(args.number)];

      if (args.reason) {
        cmdArgs.push('--reason', args.reason);
      }

      const result = await ghCli.run<unknown>(cmdArgs);

      if (!result.success) {
        throw new Error(result.error ?? `Failed to close issue #${args.number}`);
      }

      return { number: args.number, state: 'closed' };
    },

    async reopenIssue(args: IReopenIssueArgs) {
      const cmdArgs = ['issue', 'reopen', '--repo', args.repo, String(args.number)];

      const result = await ghCli.run<unknown>(cmdArgs);

      if (!result.success) {
        throw new Error(result.error ?? `Failed to reopen issue #${args.number}`);
      }

      return { number: args.number, state: 'open' };
    },

    async assignIssue(args: IAssignIssueArgs) {
      const cmdArgs = [
        'issue', 'edit',
        '--repo', args.repo,
        String(args.number),
        '--add-assignee', args.assignees.join(','),
      ];

      const result = await ghCli.run<unknown>(cmdArgs);

      if (!result.success) {
        throw new Error(result.error ?? `Failed to assign issue #${args.number}`);
      }

      return { number: args.number, assignees: args.assignees };
    },

    async labelIssue(args: ILabelIssueArgs) {
      const cmdArgs = ['issue', 'edit', '--repo', args.repo, String(args.number)];

      if (args.add?.length) {
        cmdArgs.push('--add-label', args.add.join(','));
      }
      if (args.remove?.length) {
        cmdArgs.push('--remove-label', args.remove.join(','));
      }

      const result = await ghCli.run<unknown>(cmdArgs);

      if (!result.success) {
        throw new Error(result.error ?? `Failed to update labels on issue #${args.number}`);
      }

      // Get updated labels
      const issue = await this.viewIssue({ repo: args.repo, number: args.number });
      return { number: args.number, labels: issue.labels };
    },

    // ========================================================================
    // Projects v2
    // ========================================================================

    async listProjects(args: IListProjectsArgs) {
      const { owner, name } = parseRepo(args.repo);
      const limit = args.limit ?? 20;

      const result = await ghCli.runGraphQL<{
        data: {
          repository: {
            projectsV2: {
              totalCount: number;
              nodes: Array<{
                id: string;
                number: number;
                title: string;
                url: string;
                closed: boolean;
                shortDescription?: string;
              }>;
            };
          };
        };
      }>(GRAPHQL_LIST_PROJECTS, { owner, repo: name, first: limit });

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to list projects');
      }

      const projectsData = result.data?.data?.repository?.projectsV2;
      if (!projectsData) {
        return { projects: [], total: 0 };
      }

      const projects: IGitHubProject[] = projectsData.nodes.map((p) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        url: p.url,
        closed: p.closed,
        shortDescription: p.shortDescription,
      }));

      return { projects, total: projectsData.totalCount };
    },

    async getProject(args: IGetProjectArgs) {
      const { owner, name } = parseRepo(args.repo);

      const result = await ghCli.runGraphQL<{
        data: {
          repository: {
            projectV2: {
              id: string;
              number: number;
              title: string;
              url: string;
              closed: boolean;
              shortDescription?: string;
            };
          };
        };
      }>(GRAPHQL_GET_PROJECT, { owner, repo: name, number: args.number });

      if (!result.success) {
        throw new Error(result.error ?? `Failed to get project #${args.number}`);
      }

      const project = result.data?.data?.repository?.projectV2;
      if (!project) {
        throw new Error(`Project #${args.number} not found`);
      }

      return {
        id: project.id,
        number: project.number,
        title: project.title,
        url: project.url,
        closed: project.closed,
        shortDescription: project.shortDescription,
      };
    },

    async getProjectFields(args: IGetProjectFieldsArgs) {
      const { owner, name } = parseRepo(args.repo);

      const result = await ghCli.runGraphQL<{
        data: {
          repository: {
            projectV2: {
              id: string;
              fields: {
                nodes: Array<{
                  id: string;
                  name: string;
                  dataType: string;
                  options?: Array<{ id: string; name: string }>;
                }>;
              };
            };
          };
        };
      }>(GRAPHQL_GET_PROJECT_FIELDS, { owner, repo: name, number: args.projectNumber });

      if (!result.success) {
        throw new Error(result.error ?? `Failed to get project fields for project #${args.projectNumber}`);
      }

      const projectData = result.data?.data?.repository?.projectV2;
      if (!projectData) {
        throw new Error(`Project #${args.projectNumber} not found`);
      }

      const fields: IGitHubProjectField[] = projectData.fields.nodes
        .filter((f) => f.name) // Filter out null entries
        .map((f) => ({
          id: f.id,
          name: f.name,
          dataType: f.dataType,
          options: f.options,
        }));

      return { fields };
    },

    async getProjectItems(args: IGetProjectItemsArgs) {
      const { owner, name } = parseRepo(args.repo);
      const limit = args.limit ?? 50;

      const result = await ghCli.runGraphQL<{
        data: {
          repository: {
            projectV2: {
              items: {
                totalCount: number;
                nodes: Array<{
                  id: string;
                  type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE';
                  content?: {
                    number?: number;
                    title: string;
                    url?: string;
                    state?: string;
                  };
                  fieldValues: {
                    nodes: Array<{
                      text?: string;
                      number?: number;
                      date?: string;
                      name?: string;
                      title?: string;
                      field?: { name: string };
                    }>;
                  };
                }>;
              };
            };
          };
        };
      }>(GRAPHQL_GET_PROJECT_ITEMS, { owner, repo: name, number: args.projectNumber, first: limit });

      if (!result.success) {
        throw new Error(result.error ?? `Failed to get project items for project #${args.projectNumber}`);
      }

      const itemsData = result.data?.data?.repository?.projectV2?.items;
      if (!itemsData) {
        return { items: [], total: 0 };
      }

      const items: IGitHubProjectItem[] = itemsData.nodes.map((item) => {
        const fieldValues: Record<string, string> = {};
        for (const fv of item.fieldValues.nodes) {
          if (fv.field?.name) {
            const value = fv.text ?? fv.name ?? fv.title ?? fv.date ?? (fv.number !== undefined ? String(fv.number) : '');
            if (value) {
              fieldValues[fv.field.name] = value;
            }
          }
        }

        return {
          id: item.id,
          type: item.type,
          content: item.content,
          fieldValues,
        };
      });

      return { items, total: itemsData.totalCount };
    },

    async addToProject(args: IAddToProjectArgs) {
      const { owner, name } = parseRepo(args.repo);

      // Get project ID
      const projectResult = await ghCli.runGraphQL<{
        data: { repository: { projectV2: { id: string } } };
      }>(GRAPHQL_GET_PROJECT_ID, { owner, repo: name, number: args.projectNumber });

      if (!projectResult.success || !projectResult.data?.data?.repository?.projectV2?.id) {
        throw new Error(`Project #${args.projectNumber} not found`);
      }
      const projectId = projectResult.data.data.repository.projectV2.id;

      // Get issue ID
      const issueResult = await ghCli.runGraphQL<{
        data: { repository: { issue: { id: string } } };
      }>(GRAPHQL_GET_ISSUE_ID, { owner, repo: name, number: args.issueNumber });

      if (!issueResult.success || !issueResult.data?.data?.repository?.issue?.id) {
        throw new Error(`Issue #${args.issueNumber} not found`);
      }
      const contentId = issueResult.data.data.repository.issue.id;

      // Add to project
      const addResult = await ghCli.runGraphQL<{
        data: { addProjectV2ItemById: { item: { id: string } } };
      }>(GRAPHQL_ADD_TO_PROJECT, { projectId, contentId });

      if (!addResult.success || !addResult.data?.data?.addProjectV2ItemById?.item?.id) {
        throw new Error(addResult.error ?? 'Failed to add issue to project');
      }

      return { itemId: addResult.data.data.addProjectV2ItemById.item.id };
    },

    async setProjectField(args: ISetProjectFieldArgs) {
      const { owner, name } = parseRepo(args.repo);

      // Get project ID and fields
      const projectResult = await ghCli.runGraphQL<{
        data: {
          repository: {
            projectV2: {
              id: string;
              fields: {
                nodes: Array<{
                  id: string;
                  name: string;
                  dataType: string;
                  options?: Array<{ id: string; name: string }>;
                }>;
              };
            };
          };
        };
      }>(GRAPHQL_GET_PROJECT_FIELDS, { owner, repo: name, number: args.projectNumber });

      if (!projectResult.success || !projectResult.data?.data?.repository?.projectV2) {
        throw new Error(`Project #${args.projectNumber} not found`);
      }

      const projectId = projectResult.data.data.repository.projectV2.id;
      const field = projectResult.data.data.repository.projectV2.fields.nodes.find(
        (f) => f.name?.toLowerCase() === args.fieldName.toLowerCase()
      );

      if (!field) {
        throw new Error(`Field "${args.fieldName}" not found in project #${args.projectNumber}`);
      }

      // Validate field value for SINGLE_SELECT fields
      if (field.dataType === 'SINGLE_SELECT' && field.options) {
        const option = field.options.find(
          (o) => o.name.toLowerCase() === args.value.toLowerCase()
        );
        if (!option) {
          const validOptions = field.options.map((o) => o.name).join(', ');
          throw new Error(`Invalid value "${args.value}" for field "${args.fieldName}". Valid options: ${validOptions}`);
        }
      }

      // Use gh project item-edit CLI command (more reliable than GraphQL mutation
      // since gh api graphql doesn't handle ProjectV2FieldValue input type well)
      const editArgs = [
        'project', 'item-edit',
        '--id', args.itemId,
        '--project-id', projectId,
        '--field-id', field.id,
      ];

      if (field.dataType === 'SINGLE_SELECT') {
        const option = field.options!.find(
          (o) => o.name.toLowerCase() === args.value.toLowerCase()
        );
        editArgs.push('--single-select-option-id', option!.id);
      } else if (field.dataType === 'TEXT') {
        editArgs.push('--text', args.value);
      } else if (field.dataType === 'NUMBER') {
        editArgs.push('--number', args.value);
      } else if (field.dataType === 'DATE') {
        editArgs.push('--date', args.value);
      }

      const updateResult = await ghCli.run<unknown>(editArgs);

      if (!updateResult.success) {
        throw new Error(updateResult.error ?? `Failed to update field "${args.fieldName}"`);
      }

      return { itemId: args.itemId, field: args.fieldName, value: args.value };
    },
  };
}
