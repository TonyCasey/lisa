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
 * Mutable builder for IMemoryResult during construction.
 */
export interface IMemoryResultBuilder {
  facts: IMemoryItem[];
  nodes: IMemoryItem[];
  tasks: IMemoryItem[];
  initReview: string | null;
  timedOut: boolean;
}

/**
 * Create an empty mutable memory result builder.
 */
export function createMemoryResultBuilder(): IMemoryResultBuilder {
  return {
    facts: [],
    nodes: [],
    tasks: [],
    initReview: null,
    timedOut: false,
  };
}

/**
 * Create an empty immutable memory result.
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
