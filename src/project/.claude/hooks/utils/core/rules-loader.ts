/**
 * Rules Loader - Load project rules from .lisa/rules
 *
 * Provides functions for loading and summarizing coding rules
 * and standards from the rules directory.
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// Configuration
// =============================================================================

/** Default rules directory relative to project root */
export const DEFAULT_RULES_DIR = '.lisa/rules';

/** Rule categories to scan (in order) */
export const RULE_CATEGORIES = ['shared', 'typescript', 'python', 'go', 'rust', 'java'];

/** Maximum number of H2 topics to extract per file */
export const MAX_TOPICS_PER_FILE = 3;

// =============================================================================
// Types
// =============================================================================

/**
 * A single rule file summary
 */
export interface IRuleSummary {
  /** Category (e.g., 'shared', 'typescript') */
  category: string;
  /** File name */
  file: string;
  /** Title from first H1 */
  title: string;
  /** Key topics from H2 headings */
  topics: string[];
}

/**
 * Options for loading rules
 */
export interface IRulesLoadOptions {
  /** Project root directory */
  projectRoot?: string;
  /** Rules directory (relative or absolute) */
  rulesDir?: string;
  /** Categories to scan */
  categories?: string[];
  /** Max topics per file */
  maxTopics?: number;
}

// =============================================================================
// File Parsing
// =============================================================================

/**
 * Extract the title (first H1) from markdown content
 */
export function extractTitle(content: string, fallback: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1] : fallback;
}

/**
 * Extract H2 headings from markdown content
 */
export function extractH2Headings(content: string): string[] {
  const matches = content.match(/^##\s+(.+)$/gm) || [];
  return matches.map((h) => h.replace(/^##\s+/, ''));
}

/**
 * Parse a rule file and extract summary information
 */
export function parseRuleFile(
  filePath: string,
  category: string,
  maxTopics: number = MAX_TOPICS_PER_FILE
): IRuleSummary | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);
    const title = extractTitle(content, fileName.replace('.md', ''));
    const allTopics = extractH2Headings(content);
    const topics = allTopics.slice(0, maxTopics);

    return {
      category,
      file: fileName,
      title,
      topics,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Directory Scanning
// =============================================================================

/**
 * List markdown files in a directory
 */
export function listMarkdownFiles(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    const files = fs.readdirSync(dir) as string[];
    return files.filter((f: string) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

/**
 * Load rules from a specific category directory
 */
export function loadCategoryRules(
  rulesDir: string,
  category: string,
  maxTopics: number = MAX_TOPICS_PER_FILE
): IRuleSummary[] {
  const categoryDir = path.join(rulesDir, category);
  const files = listMarkdownFiles(categoryDir);
  const rules: IRuleSummary[] = [];

  for (const file of files) {
    const filePath = path.join(categoryDir, file);
    const summary = parseRuleFile(filePath, category, maxTopics);
    if (summary) {
      rules.push(summary);
    }
  }

  return rules;
}

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Load all rules from the rules directory
 *
 * @param options - Loading options
 * @returns Array of rule summaries
 */
export function loadRules(options: IRulesLoadOptions = {}): IRuleSummary[] {
  const {
    projectRoot = process.cwd(),
    rulesDir = DEFAULT_RULES_DIR,
    categories = RULE_CATEGORIES,
    maxTopics = MAX_TOPICS_PER_FILE,
  } = options;

  const fullRulesDir = path.isAbsolute(rulesDir)
    ? rulesDir
    : path.join(projectRoot, rulesDir);

  if (!fs.existsSync(fullRulesDir)) {
    return [];
  }

  const rules: IRuleSummary[] = [];

  for (const category of categories) {
    const categoryRules = loadCategoryRules(fullRulesDir, category, maxTopics);
    rules.push(...categoryRules);
  }

  return rules;
}

/**
 * Format a rule summary as a single line
 *
 * @param rule - The rule summary to format
 * @returns Formatted string like "- shared/code-quality.md: Code Quality (Naming, Error Handling)"
 */
export function formatRuleSummary(rule: IRuleSummary): string {
  const topicsSuffix = rule.topics.length > 0 ? ` (${rule.topics.join(', ')})` : '';
  return `- ${rule.category}/${rule.file}: ${rule.title}${topicsSuffix}`;
}

/**
 * Load rules and format as a summary string
 *
 * This is the main function used by hooks to get a formatted
 * list of available rules.
 *
 * @param options - Loading options
 * @returns Formatted rules summary or null if no rules found
 */
export function loadRulesSummary(options: IRulesLoadOptions = {}): string | null {
  const rules = loadRules(options);

  if (rules.length === 0) {
    return null;
  }

  return rules.map(formatRuleSummary).join('\n');
}

/**
 * Check if rules directory exists
 *
 * @param options - Options with projectRoot and rulesDir
 * @returns True if rules directory exists
 */
export function hasRulesDir(options: IRulesLoadOptions = {}): boolean {
  const {
    projectRoot = process.cwd(),
    rulesDir = DEFAULT_RULES_DIR,
  } = options;

  const fullRulesDir = path.isAbsolute(rulesDir)
    ? rulesDir
    : path.join(projectRoot, rulesDir);

  return fs.existsSync(fullRulesDir);
}

/**
 * Get the count of available rules
 *
 * @param options - Loading options
 * @returns Number of rule files found
 */
export function getRulesCount(options: IRulesLoadOptions = {}): number {
  return loadRules(options).length;
}
