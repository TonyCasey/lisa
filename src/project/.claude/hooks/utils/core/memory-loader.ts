/**
 * Memory Loader - Load memories from Graphiti MCP
 *
 * Provides functions for loading memories, tasks, and init-review
 * from the Graphiti MCP server with timeout support.
 */

import type { IMemoryItem, IMemoryLoadOptions, IMemoryLoadResult, IMemoryResult } from './types';

// These will be injected or required at runtime
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { rpcCall } = require('../common/mcp-client');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { repoTags } = require('../common/context');

// =============================================================================
// Configuration
// =============================================================================

/** Default timeout for memory loading (ms) */
export const DEFAULT_MEMORY_TIMEOUT_MS = 5000;

/** Maximum facts to load in a single query */
export const MAX_FACTS_PER_QUERY = 100;

/** Maximum nodes to load in a single query */
export const MAX_NODES_PER_QUERY = 20;

/** Maximum tasks to load */
export const MAX_TASKS = 200;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract facts from a memory result (handles different response formats)
 */
export function extractFacts(response: IMemoryResult | null | undefined): IMemoryItem[] {
  if (!response) return [];
  return response?.result?.facts || response?.facts || [];
}

/**
 * Extract nodes from a memory result (handles different response formats)
 */
export function extractNodes(response: IMemoryResult | null | undefined): IMemoryItem[] {
  if (!response) return [];
  return response?.result?.nodes || response?.nodes || [];
}

/**
 * Generate a unique key for a memory item (for deduplication)
 */
export function getMemoryKey(item: IMemoryItem): string {
  return item.uuid || `${item.name}-${item.fact}`;
}

/**
 * Deduplicate memory items by their key
 */
export function deduplicateMemories(
  items: IMemoryItem[],
  seen: Set<string>
): IMemoryItem[] {
  const result: IMemoryItem[] = [];
  for (const item of items) {
    const key = getMemoryKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

// =============================================================================
// Individual Loaders
// =============================================================================

/**
 * Load init-review memory (codebase summary)
 */
export async function loadInitReview(
  hierarchicalGroups: string[],
  sessionId: string | null = null
): Promise<{ initReview: string | null; sessionId: string | null }> {
  try {
    const params = {
      query: 'init-review',
      max_facts: 1,
      order: 'desc',
      group_ids: hierarchicalGroups,
      tags: ['type:init-review'],
    };

    const [response, sid] = (await rpcCall('search_memory_facts', params, sessionId)) as [
      IMemoryResult,
      string
    ];

    const facts = extractFacts(response);
    if (facts.length > 0) {
      const fact = facts[0];
      return {
        initReview: fact.fact || fact.name || null,
        sessionId: sid,
      };
    }

    return { initReview: null, sessionId: sid };
  } catch {
    return { initReview: null, sessionId };
  }
}

/**
 * Load recent facts from memory
 */
export async function loadRecentFacts(
  hierarchicalGroups: string[],
  aliases: string[],
  branch: string | null,
  sessionId: string | null = null
): Promise<{ facts: IMemoryItem[]; sessionId: string | null }> {
  const seen = new Set<string>();
  const facts: IMemoryItem[] = [];
  let currentSessionId = sessionId;

  try {
    // Query with hierarchical groups (current folder + all parents)
    const recentParams = {
      query: '*',
      max_facts: MAX_FACTS_PER_QUERY,
      order: 'desc',
      group_ids: hierarchicalGroups,
    };

    const [recentResp, sid] = (await rpcCall(
      'search_memory_facts',
      recentParams,
      currentSessionId
    )) as [IMemoryResult, string];
    currentSessionId = sid;

    const recentFacts = extractFacts(recentResp);
    facts.push(...deduplicateMemories(recentFacts, seen));

    // Also query by repo aliases to catch any repo-specific memories
    for (const alias of aliases) {
      const aliasParams = {
        query: alias,
        tags: repoTags({ repo: alias, branch }),
        max_facts: 50,
        order: 'desc',
        group_ids: hierarchicalGroups,
      };

      const [aliasResp] = (await rpcCall(
        'search_memory_facts',
        aliasParams,
        currentSessionId
      )) as [IMemoryResult, string];

      const aliasFacts = extractFacts(aliasResp);
      facts.push(...deduplicateMemories(aliasFacts, seen));
    }
  } catch {
    // Continue on error
  }

  return { facts, sessionId: currentSessionId };
}

/**
 * Load nodes from memory (fallback when no facts found)
 */
export async function loadNodes(
  hierarchicalGroups: string[],
  aliases: string[],
  branch: string | null,
  sessionId: string | null = null
): Promise<{ nodes: IMemoryItem[]; sessionId: string | null }> {
  const seen = new Set<string>();
  const nodes: IMemoryItem[] = [];
  const currentSessionId = sessionId;

  try {
    for (const alias of aliases) {
      const nodeParams = {
        query: alias,
        tags: repoTags({ repo: alias, branch }),
        max_nodes: MAX_NODES_PER_QUERY,
        group_ids: hierarchicalGroups,
      };

      const [nodeResp] = (await rpcCall('search_nodes', nodeParams, currentSessionId)) as [
        IMemoryResult,
        string
      ];

      const aliasNodes = extractNodes(nodeResp);
      nodes.push(...deduplicateMemories(aliasNodes, seen));
    }
  } catch {
    // Continue on error
  }

  return { nodes, sessionId: currentSessionId };
}

/**
 * Load tasks for a repo
 */
export async function loadTasks(
  hierarchicalGroups: string[],
  aliases: string[],
  branch: string | null,
  sessionId: string | null = null
): Promise<{ tasks: IMemoryItem[]; sessionId: string | null }> {
  const seen = new Set<string>();
  const tasks: IMemoryItem[] = [];
  const currentSessionId = sessionId;

  try {
    for (const alias of aliases) {
      const taskParams = {
        query: 'task',
        tags: ['type:task', ...repoTags({ repo: alias, branch })],
        max_nodes: MAX_TASKS,
        group_ids: hierarchicalGroups,
      };

      const [taskResp] = (await rpcCall('search_nodes', taskParams, currentSessionId)) as [
        IMemoryResult,
        string
      ];

      const aliasTasks = extractNodes(taskResp);
      tasks.push(...deduplicateMemories(aliasTasks, seen));
    }
  } catch {
    // Continue on error
  }

  return { tasks, sessionId: currentSessionId };
}

// =============================================================================
// Main Loading Function
// =============================================================================

/**
 * Load all memory with an overall timeout
 *
 * This is the main entry point for loading memory at session start.
 * It loads init-review, facts, nodes (if no facts), and tasks.
 * Returns partial results if timeout occurs.
 *
 * @param options - Loading options (aliases, groups, branch, timeout)
 * @returns Memory load result with all loaded data
 */
export async function loadMemoryWithTimeout(
  options: IMemoryLoadOptions
): Promise<IMemoryLoadResult> {
  const {
    aliases,
    hierarchicalGroups,
    branch,
    timeoutMs = DEFAULT_MEMORY_TIMEOUT_MS,
  } = options;

  const result: IMemoryLoadResult = {
    facts: [],
    nodes: [],
    tasks: [],
    initReview: null,
    timedOut: false,
  };

  let sessionId: string | null = null;

  const loadPromise = async (): Promise<void> => {
    // 1. Load init-review
    const initResult = await loadInitReview(hierarchicalGroups, sessionId);
    result.initReview = initResult.initReview;
    sessionId = initResult.sessionId;

    // 2. Load recent facts
    const factsResult = await loadRecentFacts(
      hierarchicalGroups,
      aliases,
      branch,
      sessionId
    );
    result.facts = factsResult.facts;
    sessionId = factsResult.sessionId;

    // 3. Load nodes if no facts found
    if (result.facts.length === 0) {
      const nodesResult = await loadNodes(hierarchicalGroups, aliases, branch, sessionId);
      result.nodes = nodesResult.nodes;
      sessionId = nodesResult.sessionId;
    }

    // 4. Load tasks
    const tasksResult = await loadTasks(hierarchicalGroups, aliases, branch, sessionId);
    result.tasks = tasksResult.tasks;
  };

  // Race between loading and timeout
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      result.timedOut = true;
      resolve();
    }, timeoutMs);
  });

  await Promise.race([loadPromise(), timeoutPromise]);

  return result;
}

// =============================================================================
// Simplified Loaders (for user-prompt-submit)
// =============================================================================

/**
 * Load recent facts via the lisa CLI (simpler interface)
 *
 * Used by user-prompt-submit for plan mode context loading.
 * This uses the lisa memory command rather than RPC calls.
 */
export async function loadMemoryViaScript(
  cwd: string,
  limit: number = 15,
  query?: string
): Promise<string | null> {
  const { spawn, execSync } = require('child_process');

  // Check if lisa CLI is available
  try {
    execSync('lisa --version', { stdio: 'ignore' });
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    const args = ['memory', 'load', '--cache', '--limit', String(limit)];
    if (query) {
      args.push('--query', query);
    }

    const child = spawn('lisa', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += data;
    });

    child.on('close', (code: number) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout) as { status: string; facts?: Array<{ fact: string }> };
          if (result.status === 'ok' && result.facts && result.facts.length > 0) {
            const formatted = result.facts
              .slice(0, 10)
              .map((f) => `- ${f.fact}`)
              .join('\n');
            resolve(formatted);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });

    child.on('error', () => resolve(null));

    // Timeout after 5 seconds
    setTimeout(() => {
      child.kill();
      resolve(null);
    }, 5000);
  });
}

/**
 * Load retrospective memories via script
 */
export async function loadRetrospectiveViaScript(
  cwd: string,
  limit: number = 5
): Promise<string | null> {
  const result = await loadMemoryViaScript(cwd, limit, 'RETROSPECTIVE');

  if (result) {
    // Clean up RETROSPECTIVE: prefix from each line
    return result
      .split('\n')
      .map((line) => line.replace(/^-\s*RETROSPECTIVE:\s*/i, '- '))
      .join('\n');
  }

  return null;
}
