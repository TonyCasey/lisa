/**
 * IFileSystem
 *
 * Minimal file system abstraction for application-layer services
 * that need to read/write files without directly depending on Node's fs.
 *
 * Infrastructure provides the real implementation (NodeFileSystem);
 * tests provide a mock.
 */

/**
 * File stat information.
 */
export interface IFileStat {
  /** File modification time in milliseconds since epoch. */
  readonly mtimeMs: number;
}

/**
 * Minimal file system operations.
 */
export interface IFileSystem {
  /** Read a file and return its content as a UTF-8 string. Throws if not found. */
  readFile(filePath: string): Promise<string>;

  /** Write content to a file. Creates parent directories if needed. */
  writeFile(filePath: string, content: string): Promise<void>;

  /** Get file stats. Returns null if file does not exist. */
  stat(filePath: string): Promise<IFileStat | null>;
}
