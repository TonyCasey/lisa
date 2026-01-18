/**
 * Result from capturing session work.
 * Contains facts extracted from the session transcript.
 */
export interface ICapturedWork {
  readonly facts: readonly string[];
  readonly complexity: 'low' | 'medium' | 'high';
  readonly summary?: string;
}

/**
 * Create an empty captured work result.
 */
export function emptyCapturedWork(): ICapturedWork {
  return {
    facts: [],
    complexity: 'low',
    summary: undefined,
  };
}
