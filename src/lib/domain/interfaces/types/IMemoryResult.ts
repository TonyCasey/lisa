/**
 * A single memory item (fact or node) from the memory service.
 */
export interface IMemoryItem {
  readonly uuid?: string;
  readonly name?: string;
  readonly fact?: string;
  readonly tags?: readonly string[];
  readonly created_at?: string;
}

/**
 * Result from loading memory - contains facts, nodes, and tasks.
 */
export interface IMemoryResult {
  readonly facts: readonly IMemoryItem[];
  readonly nodes: readonly IMemoryItem[];
  readonly tasks: readonly IMemoryItem[];
  readonly initReview: string | null;
  readonly timedOut: boolean;
}

/**
 * Create an empty memory result.
 */
export function emptyMemoryResult(): IMemoryResult {
  return {
    facts: [],
    nodes: [],
    tasks: [],
    initReview: null,
    timedOut: false,
  };
}
