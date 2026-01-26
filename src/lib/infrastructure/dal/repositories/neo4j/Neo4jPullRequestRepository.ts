/**
 * Neo4j Pull Request Repository
 *
 * Provides direct read/write access to PR data in Neo4j.
 * Unlike Memory/Task repositories, this one supports writes directly
 * to Neo4j (not via MCP) for immediate persistence.
 *
 * PRs are user-scoped with group_id: "user:<git-config-name>".
 *
 * @see .dev/features/github-pr.md for full specification
 */

import { execSync } from 'child_process';
import type {
  IPullRequest,
  IGitHubIssue,
  IPrCheck,
  IPrComment,
  IPullRequestInput,
  IGitHubIssueInput,
  IPullRequestWithRelations,
} from '../../../../domain/interfaces/types/IPullRequest';
import type {
  IPullRequestRepository,
  IPullRequestQueryOptions,
  IPullRequestQueryResult,
} from '../../../../domain/interfaces/dal/IPullRequestRepository';
import type { Neo4jConnectionManager } from '../../connections/Neo4jConnectionManager';

/**
 * Raw Neo4j record for PR queries.
 */
interface Neo4jPrRecord {
  uuid: string;
  name: string;
  content: string;
  group_id: string;
  created_at?: string;
}

/**
 * Neo4j Pull Request Repository implementation.
 */
export class Neo4jPullRequestRepository implements IPullRequestRepository {
  private cachedUserId: string | null = null;

  constructor(private readonly connection: Neo4jConnectionManager) {}

  // ============================================================
  // Capabilities
  // ============================================================

  supportsWrite(): boolean {
    return true;
  }

  supportsRelationships(): boolean {
    return true;
  }

  // ============================================================
  // User ID Resolution
  // ============================================================

  async getUserId(): Promise<string> {
    if (this.cachedUserId) {
      return this.cachedUserId;
    }

    try {
      const name = execSync('git config user.name', { encoding: 'utf-8' }).trim();
      // Normalize: lowercase, replace spaces with hyphens
      const normalized = name.toLowerCase().replace(/\s+/g, '-');
      this.cachedUserId = `user:${normalized}`;
      return this.cachedUserId;
    } catch {
      // Fallback if git config fails
      this.cachedUserId = 'user:unknown';
      return this.cachedUserId;
    }
  }

  // ============================================================
  // UUID Generation
  // ============================================================

  private generatePrUuid(repo: string, prNumber: number): string {
    const repoSlug = repo.replace('/', '-');
    return `pr-${repoSlug}-${prNumber}`;
  }

  private generateIssueUuid(repo: string, issueNumber: number): string {
    const repoSlug = repo.replace('/', '-');
    return `issue-${repoSlug}-${issueNumber}`;
  }

  private generateCheckUuid(repo: string, prNumber: number, checkName: string): string {
    const repoSlug = repo.replace('/', '-');
    const checkSlug = checkName.replace(/[^a-zA-Z0-9]/g, '-');
    return `prcheck-${repoSlug}-${prNumber}-${checkSlug}`;
  }

  private generateCommentUuid(repo: string, commentId: string): string {
    const repoSlug = repo.replace('/', '-');
    return `prcomment-${repoSlug}-${commentId}`;
  }

  // ============================================================
  // Name Generation (for Episodic nodes)
  // ============================================================

  private generatePrName(repo: string, prNumber: number): string {
    return `PR:${repo}#${prNumber}`;
  }

  private generateIssueName(repo: string, issueNumber: number): string {
    return `ISSUE:${repo}#${issueNumber}`;
  }

  private generateCheckName(checkName: string): string {
    return `PR_CHECK:${checkName}`;
  }

  private generateCommentName(commentId: string): string {
    return `PR_COMMENT:${commentId}`;
  }

  // ============================================================
  // Readers
  // ============================================================

  async findPr(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<IPullRequest | null> {
    const uuid = this.generatePrUuid(repo, prNumber);

    const cypher = `
      MATCH (e:Episodic)
      WHERE e.uuid = $uuid AND e.group_id = $userId
      RETURN e.uuid AS uuid, e.name AS name, e.content AS content,
             e.group_id AS group_id, e.created_at AS created_at
      LIMIT 1
    `;

    const records = await this.connection.query<Neo4jPrRecord>(cypher, { uuid, userId });

    if (records.length === 0) {
      return null;
    }

    return this.parsePrRecord(records[0]);
  }

  async findWatchedPrs(
    userId: string,
    options?: IPullRequestQueryOptions
  ): Promise<IPullRequestQueryResult> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const repo = options?.repo;

    let cypher = `
      MATCH (e:Episodic)
      WHERE e.group_id = $userId
        AND e.name STARTS WITH 'PR:'
        AND e.content CONTAINS '"watching":true'
    `;

    if (repo) {
      cypher += ` AND e.content CONTAINS '"repo":"${repo}"'`;
    }

    cypher += `
      RETURN e.uuid AS uuid, e.name AS name, e.content AS content,
             e.group_id AS group_id, e.created_at AS created_at
      ORDER BY e.created_at DESC
      SKIP ${offset}
      LIMIT ${limit + 1}
    `;

    const records = await this.connection.query<Neo4jPrRecord>(cypher, { userId });
    const hasMore = records.length > limit;
    const items = records.slice(0, limit).map(r => this.parsePrRecord(r));

    return { items, hasMore };
  }

  async findIssue(
    userId: string,
    repo: string,
    issueNumber: number
  ): Promise<IGitHubIssue | null> {
    const uuid = this.generateIssueUuid(repo, issueNumber);

    const cypher = `
      MATCH (e:Episodic)
      WHERE e.uuid = $uuid AND e.group_id = $userId
      RETURN e.uuid AS uuid, e.name AS name, e.content AS content,
             e.group_id AS group_id, e.created_at AS created_at
      LIMIT 1
    `;

    const records = await this.connection.query<Neo4jPrRecord>(cypher, { uuid, userId });

    if (records.length === 0) {
      return null;
    }

    return this.parseIssueRecord(records[0]);
  }

  async findIssuesByPr(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<readonly IGitHubIssue[]> {
    const prName = this.generatePrName(repo, prNumber);

    const cypher = `
      MATCH (pr:Episodic {name: $prName, group_id: $userId})-[:CLOSES]->(issue:Episodic)
      WHERE issue.name STARTS WITH 'ISSUE:'
      RETURN issue.uuid AS uuid, issue.name AS name, issue.content AS content,
             issue.group_id AS group_id, issue.created_at AS created_at
    `;

    const records = await this.connection.query<Neo4jPrRecord>(cypher, { prName, userId });
    return records.map(r => this.parseIssueRecord(r));
  }

  async findPrsByIssue(
    userId: string,
    repo: string,
    issueNumber: number
  ): Promise<readonly IPullRequest[]> {
    const issueName = this.generateIssueName(repo, issueNumber);

    const cypher = `
      MATCH (pr:Episodic)-[:CLOSES]->(issue:Episodic {name: $issueName, group_id: $userId})
      WHERE pr.name STARTS WITH 'PR:'
      RETURN pr.uuid AS uuid, pr.name AS name, pr.content AS content,
             pr.group_id AS group_id, pr.created_at AS created_at
    `;

    const records = await this.connection.query<Neo4jPrRecord>(cypher, { issueName, userId });
    return records.map(r => this.parsePrRecord(r));
  }

  async findChecksByPr(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<readonly IPrCheck[]> {
    const prName = this.generatePrName(repo, prNumber);

    const cypher = `
      MATCH (pr:Episodic {name: $prName, group_id: $userId})-[:HAS_CHECK]->(check:Episodic)
      WHERE check.name STARTS WITH 'PR_CHECK:'
      RETURN check.uuid AS uuid, check.name AS name, check.content AS content,
             check.group_id AS group_id, check.created_at AS created_at
      ORDER BY check.created_at DESC
    `;

    const records = await this.connection.query<Neo4jPrRecord>(cypher, { prName, userId });
    return records.map(r => this.parseCheckRecord(r));
  }

  async findCommentsByPr(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<readonly IPrComment[]> {
    const prName = this.generatePrName(repo, prNumber);

    const cypher = `
      MATCH (pr:Episodic {name: $prName, group_id: $userId})-[:HAS_COMMENT]->(comment:Episodic)
      WHERE comment.name STARTS WITH 'PR_COMMENT:'
      RETURN comment.uuid AS uuid, comment.name AS name, comment.content AS content,
             comment.group_id AS group_id, comment.created_at AS created_at
      ORDER BY comment.created_at ASC
    `;

    const records = await this.connection.query<Neo4jPrRecord>(cypher, { prName, userId });
    return records.map(r => this.parseCommentRecord(r));
  }

  async getPrWithRelations(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<IPullRequestWithRelations | null> {
    const pr = await this.findPr(userId, repo, prNumber);
    if (!pr) {
      return null;
    }

    const [issues, checks, comments] = await Promise.all([
      this.findIssuesByPr(userId, repo, prNumber),
      this.findChecksByPr(userId, repo, prNumber),
      this.findCommentsByPr(userId, repo, prNumber),
    ]);

    return { pr, issues, checks, comments };
  }

  // ============================================================
  // Writers
  // ============================================================

  async upsertPr(userId: string, input: IPullRequestInput): Promise<IPullRequest> {
    const uuid = this.generatePrUuid(input.repo, input.number);
    const name = this.generatePrName(input.repo, input.number);
    const now = new Date().toISOString();

    const pr: IPullRequest = {
      type: 'pull_request',
      number: input.number,
      repo: input.repo,
      title: input.title,
      status: input.status ?? 'open',
      watching: input.watching ?? true,
      watchingSince: input.watching !== false ? now : undefined,
      checksStatus: 'pending',
      unresolvedComments: 0,
      uuid,
      created_at: now,
    };

    const content = JSON.stringify(pr);

    const cypher = `
      MERGE (e:Episodic {uuid: $uuid})
      ON CREATE SET
        e.name = $name,
        e.content = $content,
        e.group_id = $userId,
        e.created_at = datetime($createdAt),
        e.source = 'github',
        e.source_description = 'PR tracking'
      ON MATCH SET
        e.content = $content,
        e.updated_at = datetime($updatedAt)
      RETURN e.uuid AS uuid
    `;

    await this.connection.write(cypher, {
      uuid,
      name,
      content,
      userId,
      createdAt: now,
      updatedAt: now,
    });

    return pr;
  }

  async upsertIssue(userId: string, input: IGitHubIssueInput): Promise<IGitHubIssue> {
    const uuid = this.generateIssueUuid(input.repo, input.number);
    const name = this.generateIssueName(input.repo, input.number);
    const now = new Date().toISOString();

    const issue: IGitHubIssue = {
      type: 'issue',
      number: input.number,
      repo: input.repo,
      title: input.title,
      status: input.status ?? 'open',
      url: input.url,
      uuid,
      created_at: now,
    };

    const content = JSON.stringify(issue);

    const cypher = `
      MERGE (e:Episodic {uuid: $uuid})
      ON CREATE SET
        e.name = $name,
        e.content = $content,
        e.group_id = $userId,
        e.created_at = datetime($createdAt),
        e.source = 'github',
        e.source_description = 'Issue tracking'
      ON MATCH SET
        e.content = $content,
        e.updated_at = datetime($updatedAt)
      RETURN e.uuid AS uuid
    `;

    await this.connection.write(cypher, {
      uuid,
      name,
      content,
      userId,
      createdAt: now,
      updatedAt: now,
    });

    return issue;
  }

  async upsertCheck(
    userId: string,
    repo: string,
    prNumber: number,
    checkData: Omit<IPrCheck, 'type' | 'uuid' | 'created_at'>
  ): Promise<IPrCheck> {
    const uuid = this.generateCheckUuid(repo, prNumber, checkData.checkName);
    const name = this.generateCheckName(checkData.checkName);
    const prName = this.generatePrName(repo, prNumber);
    const now = new Date().toISOString();

    const check: IPrCheck = {
      type: 'pr_check',
      ...checkData,
      uuid,
      created_at: now,
    };

    const content = JSON.stringify(check);

    // Create/update check and link to PR
    const cypher = `
      MERGE (check:Episodic {uuid: $uuid})
      ON CREATE SET
        check.name = $name,
        check.content = $content,
        check.group_id = $userId,
        check.created_at = datetime($createdAt),
        check.source = 'github',
        check.source_description = 'PR check'
      ON MATCH SET
        check.content = $content,
        check.updated_at = datetime($updatedAt)
      WITH check
      MATCH (pr:Episodic {name: $prName, group_id: $userId})
      MERGE (pr)-[:HAS_CHECK]->(check)
      RETURN check.uuid AS uuid
    `;

    await this.connection.write(cypher, {
      uuid,
      name,
      content,
      userId,
      prName,
      createdAt: now,
      updatedAt: now,
    });

    return check;
  }

  async upsertComment(
    userId: string,
    repo: string,
    prNumber: number,
    commentData: Omit<IPrComment, 'type' | 'uuid'>
  ): Promise<IPrComment> {
    const uuid = this.generateCommentUuid(repo, commentData.commentId);
    const name = this.generateCommentName(commentData.commentId);
    const prName = this.generatePrName(repo, prNumber);
    const now = new Date().toISOString();

    const comment: IPrComment = {
      type: 'pr_comment',
      ...commentData,
      uuid,
    };

    const content = JSON.stringify(comment);

    // Create/update comment and link to PR
    const cypher = `
      MERGE (comment:Episodic {uuid: $uuid})
      ON CREATE SET
        comment.name = $name,
        comment.content = $content,
        comment.group_id = $userId,
        comment.created_at = datetime($createdAt),
        comment.source = 'github',
        comment.source_description = 'PR comment'
      ON MATCH SET
        comment.content = $content,
        comment.updated_at = datetime($updatedAt)
      WITH comment
      MATCH (pr:Episodic {name: $prName, group_id: $userId})
      MERGE (pr)-[:HAS_COMMENT]->(comment)
      RETURN comment.uuid AS uuid
    `;

    await this.connection.write(cypher, {
      uuid,
      name,
      content,
      userId,
      prName,
      createdAt: now,
      updatedAt: now,
    });

    return comment;
  }

  async linkPrToIssues(
    userId: string,
    repo: string,
    prNumber: number,
    issueNumbers: readonly number[]
  ): Promise<void> {
    const prName = this.generatePrName(repo, prNumber);

    // First, remove existing CLOSES relationships
    const removeCypher = `
      MATCH (pr:Episodic {name: $prName, group_id: $userId})-[r:CLOSES]->()
      DELETE r
    `;
    await this.connection.write(removeCypher, { prName, userId });

    // Then, create new CLOSES relationships
    for (const issueNumber of issueNumbers) {
      const issueName = this.generateIssueName(repo, issueNumber);

      const linkCypher = `
        MATCH (pr:Episodic {name: $prName, group_id: $userId})
        MATCH (issue:Episodic {name: $issueName, group_id: $userId})
        MERGE (pr)-[:CLOSES]->(issue)
      `;
      await this.connection.write(linkCypher, { prName, issueName, userId });
    }
  }

  async setWatching(
    userId: string,
    repo: string,
    prNumber: number,
    watching: boolean
  ): Promise<void> {
    const uuid = this.generatePrUuid(repo, prNumber);
    const now = new Date().toISOString();

    // First get the current PR
    const pr = await this.findPr(userId, repo, prNumber);
    if (!pr) {
      throw new Error(`PR not found: ${repo}#${prNumber}`);
    }

    // Update watching status
    const updatedPr: IPullRequest = {
      ...pr,
      watching,
      watchingSince: watching ? now : undefined,
    };

    const content = JSON.stringify(updatedPr);

    const cypher = `
      MATCH (e:Episodic {uuid: $uuid, group_id: $userId})
      SET e.content = $content, e.updated_at = datetime($updatedAt)
    `;

    await this.connection.write(cypher, { uuid, userId, content, updatedAt: now });
  }

  async updateLastPolled(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<void> {
    const uuid = this.generatePrUuid(repo, prNumber);
    const now = new Date().toISOString();

    // First get the current PR
    const pr = await this.findPr(userId, repo, prNumber);
    if (!pr) {
      throw new Error(`PR not found: ${repo}#${prNumber}`);
    }

    // Update lastPolled
    const updatedPr: IPullRequest = {
      ...pr,
      lastPolled: now,
    };

    const content = JSON.stringify(updatedPr);

    const cypher = `
      MATCH (e:Episodic {uuid: $uuid, group_id: $userId})
      SET e.content = $content, e.updated_at = datetime($updatedAt)
    `;

    await this.connection.write(cypher, { uuid, userId, content, updatedAt: now });
  }

  async deletePr(
    userId: string,
    repo: string,
    prNumber: number
  ): Promise<void> {
    const prName = this.generatePrName(repo, prNumber);

    // Delete PR and all relationships
    const cypher = `
      MATCH (pr:Episodic {name: $prName, group_id: $userId})
      OPTIONAL MATCH (pr)-[:HAS_CHECK]->(check:Episodic)
      OPTIONAL MATCH (pr)-[:HAS_COMMENT]->(comment:Episodic)
      DETACH DELETE pr, check, comment
    `;

    await this.connection.write(cypher, { prName, userId });
  }

  // ============================================================
  // Parsers
  // ============================================================

  private parsePrRecord(record: Neo4jPrRecord): IPullRequest {
    try {
      const content = JSON.parse(record.content) as IPullRequest;
      return {
        ...content,
        uuid: record.uuid,
        created_at: record.created_at ?? content.created_at,
      };
    } catch {
      // Fallback for malformed content
      return {
        type: 'pull_request',
        number: 0,
        repo: '',
        title: record.name.replace(/^PR:/, ''),
        status: 'open',
        watching: false,
        checksStatus: 'pending',
        unresolvedComments: 0,
        uuid: record.uuid,
        created_at: record.created_at,
      };
    }
  }

  private parseIssueRecord(record: Neo4jPrRecord): IGitHubIssue {
    try {
      const content = JSON.parse(record.content) as IGitHubIssue;
      return {
        ...content,
        uuid: record.uuid,
        created_at: record.created_at ?? content.created_at,
      };
    } catch {
      return {
        type: 'issue',
        number: 0,
        repo: '',
        title: record.name.replace(/^ISSUE:/, ''),
        status: 'open',
        url: '',
        uuid: record.uuid,
        created_at: record.created_at,
      };
    }
  }

  private parseCheckRecord(record: Neo4jPrRecord): IPrCheck {
    try {
      const content = JSON.parse(record.content) as IPrCheck;
      return {
        ...content,
        uuid: record.uuid,
        created_at: record.created_at ?? content.created_at,
      };
    } catch {
      return {
        type: 'pr_check',
        checkName: record.name.replace(/^PR_CHECK:/, ''),
        status: 'pending',
        updatedAt: new Date().toISOString(),
        uuid: record.uuid,
        created_at: record.created_at,
      };
    }
  }

  private parseCommentRecord(record: Neo4jPrRecord): IPrComment {
    try {
      const content = JSON.parse(record.content) as IPrComment;
      return {
        ...content,
        uuid: record.uuid,
      };
    } catch {
      const now = new Date().toISOString();
      return {
        type: 'pr_comment',
        commentId: record.name.replace(/^PR_COMMENT:/, ''),
        file: '',
        line: 0,
        author: '',
        body: '',
        status: 'pending',
        hasNewReply: false,
        createdAt: now,
        updatedAt: now,
        uuid: record.uuid,
      };
    }
  }
}
