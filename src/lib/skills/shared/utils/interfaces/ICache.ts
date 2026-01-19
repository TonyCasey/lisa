/**
 * Interface for cache operations.
 * Used for storing and retrieving cached data (e.g., fallback for offline).
 */
export interface ICache {
  /**
   * Write data to cache.
   * @param key - Cache key identifier
   * @param data - Data to cache (will be JSON serialized)
   */
  write(key: string, data: unknown): void;

  /**
   * Read data from cache.
   * @param key - Cache key identifier
   * @returns Cached data or null if not found
   */
  read(key: string): unknown | null;

  /**
   * Read the most recent entry from a log-style cache.
   * @param key - Cache key identifier
   * @returns Most recent entry or null if not found
   */
  readLatest(key: string): unknown | null;

  /**
   * Get the file path for a cache key.
   * @param key - Cache key identifier
   * @returns Absolute file path
   */
  getFilePath(key: string): string;

  /**
   * Clear all entries for a cache key.
   * @param key - Cache key identifier
   */
  clear(key: string): void;
}

/**
 * Configuration options for creating a cache.
 */
export interface ICacheConfig {
  /** Directory to store cache files */
  cacheDir: string;
  /** Maximum cache file size in bytes before rotation */
  maxSizeBytes?: number;
  /** Whether to append (log style) or overwrite */
  appendMode?: boolean;
}
