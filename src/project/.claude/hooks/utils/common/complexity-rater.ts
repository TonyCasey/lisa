/**
 * Complexity Rater for Claude Code work sessions
 *
 * Rates work complexity on a 1-5 scale based on signals extracted from transcripts.
 * Used to determine whether work should be stored in Graphiti (3+) or local logs (1-2).
 */
export {}; // mark as module to keep scoped declarations

interface IWorkSummary {
  filesModified: Set<string>;
  filesCreated: Set<string>;
  commandsRun: string[];
  toolsUsed: Map<string, number>;
  assistantSummary: string;
  timestamp: string;
  durationMs: number;
  totalCostUSD: number;
}

interface IComplexitySignals {
  filesModified: number;
  filesCreated: number;
  versionBump: boolean;
  docsCreated: number;
  testsModified: number;
  configFiles: number;
  structuralChanges: number;
  toolDiversity: number;
  commandCount: number;
}

interface IComplexityRating {
  rating: 1 | 2 | 3 | 4 | 5;
  rawScore: number;
  signals: string[];
  summary: string;
}

// Scoring constants
const POINTS = {
  FILE_CREATED: 3,
  FILE_EDITED: 2,
  COMMAND_RUN: 1.5,
  DOC_CREATED: 2,
  TEST_MODIFIED: 1.5,
  CONFIG_FILE: 1,
  VERSION_BUMP: 2,
  STRUCTURAL_CHANGE: 2,
  MULTI_DIRECTORY: 3,
  CI_CD_SETUP: 3,
};

const MULTIPLIERS = {
  TOOL_DIVERSITY_5: 1.2,
  TOOL_DIVERSITY_8: 1.3,
};

// Score thresholds for rating normalization
const THRESHOLDS = {
  RATING_2: 2,
  RATING_3: 5,
  RATING_4: 10,
  RATING_5: 20,
};

// Version files to detect version bumps
const VERSION_FILES = ['package.json', 'pyproject.toml', 'Cargo.toml', 'setup.py', 'version.py', 'VERSION'];

// Config files that indicate setup/configuration work
const CONFIG_PATTERNS = [
  'tsconfig.json',
  'tsconfig',
  'jest.config',
  '.eslintrc',
  '.prettierrc',
  'webpack.config',
  'vite.config',
  'rollup.config',
  '.gitignore',
  '.dockerignore',
  'Dockerfile',
  'docker-compose',
  '.github/workflows',
  '.gitlab-ci',
  'Makefile',
  'CMakeLists',
];

// CI/CD indicators
const CI_CD_PATTERNS = ['.github/workflows', '.gitlab-ci', 'Jenkinsfile', '.circleci', '.travis'];

/**
 * Rate the complexity of work based on signals
 */
function rateComplexity(work: IWorkSummary): IComplexityRating {
  const signals = extractSignals(work);
  const rawScore = calculateRawScore(signals, work);
  const rating = normalizeToRating(rawScore);
  const signalDescriptions = describeSignals(signals, work);
  const summary = generateSummary(rating, signals, work);

  return {
    rating,
    rawScore: Math.round(rawScore * 10) / 10,
    signals: signalDescriptions,
    summary,
  };
}

/**
 * Extract complexity signals from work summary
 */
function extractSignals(work: IWorkSummary): IComplexitySignals {
  const filesModified = work.filesModified.size;
  const filesCreated = work.filesCreated.size;
  const allFiles = [...work.filesModified, ...work.filesCreated];

  return {
    filesModified,
    filesCreated,
    versionBump: hasVersionBump(allFiles),
    docsCreated: countDocs(work.filesCreated),
    testsModified: countTests(allFiles),
    configFiles: countConfigFiles(allFiles),
    structuralChanges: countStructuralChanges(work.commandsRun),
    toolDiversity: work.toolsUsed.size,
    commandCount: work.commandsRun.length,
  };
}

/**
 * Calculate raw score from signals
 */
function calculateRawScore(signals: IComplexitySignals, work: IWorkSummary): number {
  let score = 0;

  // Base points for file operations
  score += signals.filesCreated * POINTS.FILE_CREATED;
  score += signals.filesModified * POINTS.FILE_EDITED;

  // Points for commands (weighted)
  score += signals.commandCount * POINTS.COMMAND_RUN;

  // Bonus points for specific types
  score += signals.docsCreated * POINTS.DOC_CREATED;
  score += signals.testsModified * POINTS.TEST_MODIFIED;
  score += signals.configFiles * POINTS.CONFIG_FILE;

  // Bonus for version bump
  if (signals.versionBump) {
    score += POINTS.VERSION_BUMP;
  }

  // Bonus for structural changes
  score += signals.structuralChanges * POINTS.STRUCTURAL_CHANGE;

  // Bonus for multi-directory work
  if (hasMultiDirectoryWork(work)) {
    score += POINTS.MULTI_DIRECTORY;
  }

  // Bonus for CI/CD setup
  if (hasCICDSetup(work)) {
    score += POINTS.CI_CD_SETUP;
  }

  // Apply multipliers for tool diversity
  if (signals.toolDiversity >= 8) {
    score *= MULTIPLIERS.TOOL_DIVERSITY_8;
  } else if (signals.toolDiversity >= 5) {
    score *= MULTIPLIERS.TOOL_DIVERSITY_5;
  }

  return score;
}

/**
 * Normalize raw score to 1-5 rating
 */
function normalizeToRating(rawScore: number): 1 | 2 | 3 | 4 | 5 {
  if (rawScore >= THRESHOLDS.RATING_5) return 5;
  if (rawScore >= THRESHOLDS.RATING_4) return 4;
  if (rawScore >= THRESHOLDS.RATING_3) return 3;
  if (rawScore >= THRESHOLDS.RATING_2) return 2;
  return 1;
}

/**
 * Check if any version files were modified
 */
function hasVersionBump(files: string[]): boolean {
  return files.some((filePath) => VERSION_FILES.some((vf) => filePath.endsWith(vf) || filePath.includes(vf)));
}

/**
 * Count documentation files created
 */
function countDocs(filesCreated: Set<string>): number {
  return Array.from(filesCreated).filter(
    (filePath) => filePath.endsWith('.md') || filePath.includes('/docs/') || filePath.toUpperCase().includes('README')
  ).length;
}

/**
 * Count test files modified or created
 */
function countTests(files: string[]): number {
  return files.filter(
    (filePath) =>
      /\.(test|spec)\.(ts|js|tsx|jsx|py|rs)$/.test(filePath) ||
      filePath.includes('/tests/') ||
      filePath.includes('/__tests__/') ||
      filePath.includes('/test/')
  ).length;
}

/**
 * Count config files modified
 */
function countConfigFiles(files: string[]): number {
  return files.filter((filePath) => CONFIG_PATTERNS.some((pattern) => filePath.includes(pattern))).length;
}

/**
 * Count structural changes (mkdir commands)
 */
function countStructuralChanges(commands: string[]): number {
  return commands.filter((cmd) => cmd.startsWith('mkdir') || cmd.includes('mkdir ')).length;
}

/**
 * Check if work spans multiple directories
 */
function hasMultiDirectoryWork(work: IWorkSummary): boolean {
  const allFiles = [...work.filesModified, ...work.filesCreated];
  const directories = new Set<string>();

  for (const filePath of allFiles) {
    const parts = filePath.split('/');
    if (parts.length > 1) {
      directories.add(parts[0]);
    }
  }

  return directories.size >= 3;
}

/**
 * Check if CI/CD files were created/modified
 */
function hasCICDSetup(work: IWorkSummary): boolean {
  const allFiles = [...work.filesModified, ...work.filesCreated];
  return allFiles.some((filePath) => CI_CD_PATTERNS.some((pattern) => filePath.includes(pattern)));
}

/**
 * Generate human-readable signal descriptions
 */
function describeSignals(signals: IComplexitySignals, work: IWorkSummary): string[] {
  const descriptions: string[] = [];

  if (signals.filesCreated > 0) {
    descriptions.push(`${signals.filesCreated} file${signals.filesCreated > 1 ? 's' : ''} created`);
  }

  if (signals.filesModified > 0) {
    descriptions.push(`${signals.filesModified} file${signals.filesModified > 1 ? 's' : ''} modified`);
  }

  if (signals.testsModified > 0) {
    descriptions.push(`${signals.testsModified} test file${signals.testsModified > 1 ? 's' : ''}`);
  }

  if (signals.docsCreated > 0) {
    descriptions.push(`${signals.docsCreated} documentation file${signals.docsCreated > 1 ? 's' : ''}`);
  }

  if (signals.versionBump) {
    descriptions.push('Version bump detected');
  }

  if (signals.configFiles > 0) {
    descriptions.push(`${signals.configFiles} config file${signals.configFiles > 1 ? 's' : ''}`);
  }

  if (signals.structuralChanges > 0) {
    descriptions.push(`${signals.structuralChanges} structural change${signals.structuralChanges > 1 ? 's' : ''}`);
  }

  if (hasMultiDirectoryWork(work)) {
    descriptions.push('Multi-directory changes');
  }

  if (hasCICDSetup(work)) {
    descriptions.push('CI/CD setup');
  }

  if (signals.toolDiversity >= 5) {
    descriptions.push(`${signals.toolDiversity} different tools used`);
  }

  return descriptions;
}

/**
 * Generate a summary description of the work
 */
function generateSummary(rating: number, signals: IComplexitySignals, work: IWorkSummary): string {
  const ratingLabels: Record<number, string> = {
    1: 'Trivial',
    2: 'Simple',
    3: 'Moderate',
    4: 'Complex',
    5: 'Very Complex',
  };

  const label = ratingLabels[rating] || 'Unknown';
  const totalFiles = signals.filesCreated + signals.filesModified;

  // Generate contextual summary
  if (rating === 1) {
    if (totalFiles === 0) {
      return `${label}: Read-only session or minimal interaction`;
    }
    return `${label}: Minor change to ${totalFiles} file${totalFiles > 1 ? 's' : ''}`;
  }

  if (rating === 2) {
    return `${label}: ${totalFiles} file${totalFiles > 1 ? 's' : ''} affected`;
  }

  if (rating === 3) {
    const extras: string[] = [];
    if (signals.testsModified > 0) extras.push('tests');
    if (signals.docsCreated > 0) extras.push('docs');
    const extra = extras.length > 0 ? ` with ${extras.join(' and ')}` : '';
    return `${label}: Feature implementation${extra}`;
  }

  if (rating === 4) {
    return `${label}: Multi-file refactor or significant feature`;
  }

  // Rating 5
  const highlights: string[] = [];
  if (signals.versionBump) highlights.push('version bump');
  if (hasCICDSetup(work)) highlights.push('CI/CD');
  if (signals.docsCreated >= 2) highlights.push('documentation');
  const highlight = highlights.length > 0 ? `: ${highlights.join(', ')}` : '';
  return `${label}: Major milestone${highlight}`;
}

/**
 * Get rating label
 */
function getRatingLabel(rating: number): string {
  const labels: Record<number, string> = {
    1: 'Trivial',
    2: 'Simple',
    3: 'Moderate',
    4: 'Complex',
    5: 'Very Complex',
  };
  return labels[rating] || 'Unknown';
}

module.exports = {
  rateComplexity,
  getRatingLabel,
  THRESHOLDS,
};
