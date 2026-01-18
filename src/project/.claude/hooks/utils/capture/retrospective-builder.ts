/**
 * Retrospective Builder - Analyze work patterns and build learnings
 *
 * Extracts patterns from files created/modified during a session
 * to generate retrospective learnings about project structure,
 * naming conventions, and technology choices.
 */

const path = require('path');

// =============================================================================
// Types
// =============================================================================

/**
 * Analysis result for file patterns
 */
export interface IPatternAnalysis {
  /** Directory structure patterns */
  directories: Set<string>;
  /** File extension counts */
  extensions: Map<string, number>;
  /** Whether tests were touched */
  hasTests: boolean;
  /** Whether type definitions were touched */
  hasTypes: boolean;
  /** Test directory (if detected) */
  testDir: string | null;
}

/**
 * Naming convention detection result
 */
export interface INamingPatterns {
  kebabCount: number;
  camelCount: number;
  pascalCount: number;
  snakeCount: number;
  total: number;
}

// =============================================================================
// Pattern Analysis
// =============================================================================

/**
 * Analyze file list to extract patterns
 *
 * @param files - List of file paths
 * @returns Pattern analysis result
 */
export function analyzeFilePatterns(files: string[]): IPatternAnalysis {
  const directories = new Set<string>();
  const extensions = new Map<string, number>();
  const hasTests = files.some(
    (f) => f.includes('test') || f.includes('spec') || f.includes('__tests__')
  );
  const hasTypes = files.some((f) => f.endsWith('.d.ts') || f.includes('types'));

  let testDir: string | null = null;

  for (const file of files) {
    // Track directories (top-level only)
    const dir = path.dirname(file);
    if (dir && dir !== '.') {
      const topDir = dir.split(/[/\\]/)[0];
      if (topDir) {
        directories.add(topDir);
      }
    }

    // Track extensions
    const ext = path.extname(file);
    if (ext) {
      extensions.set(ext, (extensions.get(ext) || 0) + 1);
    }

    // Track test directory
    if (
      !testDir &&
      (file.includes('test') || file.includes('spec') || file.includes('__tests__'))
    ) {
      testDir = path.dirname(file);
    }
  }

  return {
    directories,
    extensions,
    hasTests,
    hasTypes,
    testDir,
  };
}

/**
 * Detect naming conventions from file names
 *
 * @param files - List of file paths
 * @returns Naming pattern counts
 */
export function detectNamingPatterns(files: string[]): INamingPatterns {
  const fileNames = files.map((f) => path.basename(f, path.extname(f)));

  let kebabCount = 0;
  let camelCount = 0;
  let pascalCount = 0;
  let snakeCount = 0;

  for (const name of fileNames) {
    if (name.includes('-')) {
      kebabCount++;
    } else if (name.includes('_')) {
      snakeCount++;
    } else if (name[0] === name[0].toUpperCase() && /[a-z]/.test(name)) {
      pascalCount++;
    } else if (/[a-z][A-Z]/.test(name)) {
      camelCount++;
    }
  }

  return {
    kebabCount,
    camelCount,
    pascalCount,
    snakeCount,
    total: fileNames.length,
  };
}

/**
 * Format naming patterns as a human-readable string
 *
 * @param patterns - Naming pattern counts
 * @returns Description string or null if no dominant pattern
 */
export function formatNamingPatterns(patterns: INamingPatterns): string | null {
  if (patterns.total === 0) return null;

  const descriptions: string[] = [];
  const threshold = 0.5;

  if (patterns.kebabCount / patterns.total > threshold) {
    descriptions.push('kebab-case for files');
  }
  if (patterns.camelCount / patterns.total > threshold) {
    descriptions.push('camelCase for files');
  }
  if (patterns.pascalCount / patterns.total > threshold) {
    descriptions.push('PascalCase for files');
  }
  if (patterns.snakeCount / patterns.total > threshold) {
    descriptions.push('snake_case for files');
  }

  return descriptions.length > 0 ? descriptions.join(', ') : null;
}

// =============================================================================
// Retrospective Building
// =============================================================================

/**
 * Build retrospective learnings from file patterns
 *
 * @param files - List of files created/modified
 * @returns Formatted retrospective string or null if no patterns
 */
export function buildRetrospective(files: string[]): string | null {
  if (files.length === 0) return null;

  const learnings: string[] = [];
  const analysis = analyzeFilePatterns(files);

  // Structure patterns
  if (analysis.directories.size > 0) {
    const topDirs = Array.from(analysis.directories).slice(0, 5);
    learnings.push(`STRUCTURE: Files organized in ${topDirs.join(', ')}`);
  }

  // Technology patterns
  const extList = Array.from(analysis.extensions.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([ext]) => ext);
  if (extList.length > 0) {
    learnings.push(`TECH: Primary file types ${extList.join(', ')}`);
  }

  // Test patterns
  if (analysis.hasTests && analysis.testDir) {
    learnings.push(`TESTING: Tests located in ${analysis.testDir}`);
  }

  // Type patterns
  if (analysis.hasTypes) {
    learnings.push('STYLE: Project uses TypeScript type definitions');
  }

  // Naming patterns
  const namingPatterns = detectNamingPatterns(files);
  const namingDescription = formatNamingPatterns(namingPatterns);
  if (namingDescription) {
    learnings.push(`NAMING: ${namingDescription}`);
  }

  return learnings.length > 0 ? learnings.join('; ') : null;
}

/**
 * Format retrospective as a prefixed string for storage
 *
 * @param retrospective - Raw retrospective text
 * @returns Formatted string with RETROSPECTIVE: prefix
 */
export function formatRetrospectiveForStorage(retrospective: string): string {
  return `RETROSPECTIVE: ${retrospective}`;
}
