/**
 * Memory Skill CLI Client
 *
 * Provides typed helpers for invoking the memory skill script.
 * Used by integration tests to verify I/O contracts from SKILL.md.
 * Updated for git-mem backend.
 */
import {
  findSkillScript,
  runSkillScript,
} from '../shared/cli-runner';
import type { ICliRunnerOptions } from '../shared/types';

// =============================================================================
// I/O Contract Types (from SKILL.md)
// =============================================================================

/**
 * Memory fact structure returned by load operation
 */
export interface IMemoryFact {
  uuid?: string;
  name?: string;
  fact?: string;
  created_at?: string;
}

/**
 * Response from memory add operation
 * SKILL.md: { status: "ok", action: "add", group, text }
 */
export interface IMemoryAddResponse {
  status: 'ok' | 'fallback';
  action: 'add';
  group: string;
  text: string;
  tag?: string;
  message_uuid?: string;
  mode?: 'git-mem';
}

/**
 * Response from memory load operation
 * SKILL.md: { status: "ok", action: "load", group, query, facts: [...] }
 */
export interface IMemoryLoadResponse {
  status: 'ok' | 'fallback';
  action: 'load';
  group: string;
  groups?: string[];
  query?: string;
  facts: IMemoryFact[];
  mode?: 'git-mem';
}

/**
 * Fallback response when backend is unavailable
 * SKILL.md: { status: "fallback", error, fallback: <cached object> }
 */
export interface IMemoryFallbackResponse {
  status: 'fallback';
  error: string;
  fallback: IMemoryAddResponse | IMemoryLoadResponse;
}

export type MemoryResponse =
  | IMemoryAddResponse
  | IMemoryLoadResponse
  | IMemoryFallbackResponse;

// =============================================================================
// CLI Detection
// =============================================================================

/** Skill name for memory operations (used with Lisa CLI) */
export const memoryScriptPath = findSkillScript('memory');

/** Whether the Lisa CLI is available for memory operations */
export const memoryScriptExists = memoryScriptPath !== null;

// =============================================================================
// Client Options
// =============================================================================

export interface IMemoryClientOptions extends ICliRunnerOptions {
  /** Maximum number of facts to return (default: 10) */
  limit?: number;
  /** Search query (default: '*' for all) */
  query?: string;
  /** Tag to apply to memory */
  tag?: string;
  /** Type for auto-tag detection */
  type?: string;
  /** Source identifier */
  source?: string;
}

// =============================================================================
// Memory Operations
// =============================================================================

/**
 * Add a memory via the skill script
 *
 * @param text - Memory content to store
 * @param options - Client options
 * @returns Add response with status and stored text
 * @throws Error if script not found or execution fails
 */
export async function addMemory(
  text: string,
  options: IMemoryClientOptions = {}
): Promise<IMemoryAddResponse> {
  if (!memoryScriptPath) {
    throw new Error('Memory script not found. Run `npm run build` first.');
  }

  const args = ['add', `"${text.replace(/"/g, '\\"')}"`];
  if (options.tag) args.push('--tag', options.tag);
  if (options.type) args.push('--type', options.type);
  if (options.source) args.push('--source', options.source);

  const result = await runSkillScript<IMemoryAddResponse>(
    memoryScriptPath,
    args,
    options
  );

  if (!result.data) {
    throw new Error(result.error || 'Failed to add memory: no response data');
  }

  // Allow both 'ok' and 'fallback' status - caller can check
  if (result.data.status !== 'ok' && result.data.status !== 'fallback') {
    throw new Error(`Unexpected status: ${result.data.status}`);
  }

  return result.data;
}

/**
 * Load memories via the skill script
 *
 * @param options - Client options including query and limit
 * @returns Load response with facts array
 * @throws Error if script not found or execution fails
 */
export async function loadMemory(
  options: IMemoryClientOptions = {}
): Promise<IMemoryLoadResponse> {
  if (!memoryScriptPath) {
    throw new Error('Memory script not found. Run `npm run build` first.');
  }

  const args = ['load'];
  if (options.limit) args.push('--limit', String(options.limit));
  if (options.query) args.push('--query', options.query);

  const result = await runSkillScript<IMemoryLoadResponse>(
    memoryScriptPath,
    args,
    options
  );

  if (!result.data) {
    throw new Error(result.error || 'Failed to load memory: no response data');
  }

  // Allow both 'ok' and 'fallback' status
  if (result.data.status !== 'ok' && result.data.status !== 'fallback') {
    throw new Error(`Unexpected status: ${result.data.status}`);
  }

  return result.data;
}

/**
 * Check if git-mem is ready and working in the test repository
 *
 * @param options - Client options (must include testRepoPath)
 * @returns Object with ok status and optional error
 */
export async function checkGitMemReady(
  options: IMemoryClientOptions = {}
): Promise<{ ok: boolean; error?: Error }> {
  try {
    const result = await loadMemory({ ...options, limit: 1 });
    return { ok: result.status === 'ok' };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

/**
 * Run a smoke test suite for memory persistence and isolation
 *
 * Tests:
 * 1. Add memory to primary group
 * 2. Load from primary group and verify found
 * 3. Load from isolation group and verify NOT found
 *
 * @param options - Suite configuration
 * @returns Suite results with pass/fail status
 */
export async function runMemorySmokeSuite(options: {
  testRepoPath: string;
  groupId: string;
  isolationGroupId: string;
}): Promise<{
  addResponse: IMemoryAddResponse;
  loadResponse: IMemoryLoadResponse;
  primaryFound: boolean;
  isolationLeaked: boolean;
}> {
  const uniqueMarker = `smoke-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Add memory
  const addResponse = await addMemory(`Memory smoke test: ${uniqueMarker}`, {
    testRepoPath: options.testRepoPath,
    groupId: options.groupId,
  });

  // git-mem is synchronous - no delay needed

  // Load from primary group
  const loadResponse = await loadMemory({
    testRepoPath: options.testRepoPath,
    groupId: options.groupId,
    limit: 25,
  });

  // Check if memory was found
  const primaryFound = loadResponse.facts.some(
    (fact) => (fact.fact || fact.name || '').includes(uniqueMarker)
  );

  // Load from isolation group (should NOT find the memory)
  const isolationLoad = await loadMemory({
    testRepoPath: options.testRepoPath,
    groupId: options.isolationGroupId,
    limit: 15,
  });

  const isolationLeaked = isolationLoad.facts.some(
    (fact) => (fact.fact || fact.name || '').includes(uniqueMarker)
  );

  return {
    addResponse,
    loadResponse,
    primaryFound,
    isolationLeaked,
  };
}
