/**
 * Preference Store Interface.
 *
 * Defines a key-value store for user preferences.
 * Fast lookups by key, permanent lifecycle, separate from the knowledge graph.
 *
 * Part of Phase 5D: Preference Key-Value Store.
 */

/**
 * A stored preference entry.
 */
export interface IPreference {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: string;
}

/**
 * Preference store contract.
 * Simple key-value semantics with list/has helpers.
 */
export interface IPreferenceStore {
  /**
   * Get a preference value by key.
   * @returns The stored value, or null if not found.
   */
  get(key: string): Promise<string | null>;

  /**
   * Set a preference value.
   * Creates the key if it doesn't exist, overwrites if it does.
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Delete a preference by key.
   * @returns true if the key existed and was deleted, false otherwise.
   */
  delete(key: string): Promise<boolean>;

  /**
   * List all stored preferences.
   */
  list(): Promise<readonly IPreference[]>;

  /**
   * Check whether a key exists.
   */
  has(key: string): Promise<boolean>;
}
