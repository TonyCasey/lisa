/**
 * PR Review Handler
 *
 * Runs local AI code review on the current branch diff before creating a PR.
 * Uses Claude/Codex to analyze changes and categorize issues by severity.
 *
 * @see .dev/features/github-pr.md for full specification
 */

import { execSync } from 'child_process';

/**
 * Options for PR review.
 */
export interface IPrReviewOptions {
  /** Base branch to diff against (default: main or master). */
  readonly base?: string;
  /** Exit non-zero if critical issues found. */
  readonly block?: boolean;
  /** Output as JSON. */
  readonly json?: boolean;
}

/**
 * A single review issue found in the code.
 */
export interface IReviewIssue {
  /** Severity level. */
  readonly severity: 'critical' | 'warning' | 'suggestion';
  /** File path where the issue was found. */
  readonly file: string;
  /** Line number (if available). */
  readonly line?: number;
  /** Description of the issue. */
  readonly message: string;
  /** Code snippet (if available). */
  readonly snippet?: string;
}

/**
 * Result from PR review.
 */
export interface IPrReviewResult {
  readonly success: boolean;
  readonly message: string;
  /** Base branch used for diff. */
  readonly base: string;
  /** Number of files changed. */
  readonly filesChanged: number;
  /** List of changed files. */
  readonly files: readonly string[];
  /** Issues found during review. */
  readonly issues: readonly IReviewIssue[];
  /** Summary counts by severity. */
  readonly counts: {
    readonly critical: number;
    readonly warning: number;
    readonly suggestion: number;
  };
  /** Passed checks (things that look good). */
  readonly passed: readonly string[];
  /** Whether review should block (has critical issues and --block flag). */
  readonly shouldBlock: boolean;
  /** Error message if AI review failed. */
  readonly reviewError?: string;
}

/**
 * Handler for running local AI code review.
 */
export class PrReviewHandler {
  /**
   * Run AI review on the current branch diff.
   */
  async execute(options: IPrReviewOptions = {}): Promise<IPrReviewResult> {
    try {
      // 1. Determine base branch
      const base = options.base || this.detectDefaultBranch();

      // 2. Get diff and changed files
      const diff = this.getDiff(base);
      const files = this.getChangedFiles(base);

      if (files.length === 0) {
        return {
          success: true,
          message: 'No changes to review',
          base,
          filesChanged: 0,
          files: [],
          issues: [],
          counts: { critical: 0, warning: 0, suggestion: 0 },
          passed: [],
          shouldBlock: false,
        };
      }

      // 3. Run AI review
      let issues: IReviewIssue[] = [];
      let passed: string[] = [];
      let reviewError: string | undefined;

      try {
        const reviewResult = await this.runAiReview(diff, files);
        issues = reviewResult.issues;
        passed = reviewResult.passed;
      } catch (error) {
        reviewError = error instanceof Error ? error.message : String(error);
        // Continue with empty issues - we can still show diff info
      }

      // 4. Count issues by severity
      const counts = {
        critical: issues.filter(i => i.severity === 'critical').length,
        warning: issues.filter(i => i.severity === 'warning').length,
        suggestion: issues.filter(i => i.severity === 'suggestion').length,
      };

      // 5. Determine if should block
      const shouldBlock = options.block === true && counts.critical > 0;

      return {
        success: !reviewError,
        message: reviewError 
          ? `Review completed with errors: ${reviewError}`
          : `Review complete: ${counts.critical} critical, ${counts.warning} warnings, ${counts.suggestion} suggestions`,
        base,
        filesChanged: files.length,
        files,
        issues,
        counts,
        passed,
        shouldBlock,
        reviewError,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to run review: ${message}`,
        base: options.base || 'unknown',
        filesChanged: 0,
        files: [],
        issues: [],
        counts: { critical: 0, warning: 0, suggestion: 0 },
        passed: [],
        shouldBlock: false,
      };
    }
  }

  /**
   * Detect the default branch (main or master).
   */
  private detectDefaultBranch(): string {
    try {
      // Try to get from git remote
      const result = execSync('git remote show origin 2>/dev/null | grep "HEAD branch" | cut -d: -f2', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (result) return result;
    } catch {
      // Ignore
    }

    // Fallback: check if main exists, otherwise master
    try {
      execSync('git rev-parse --verify main 2>/dev/null', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return 'main';
    } catch {
      return 'master';
    }
  }

  /**
   * Get diff between base and HEAD.
   */
  private getDiff(base: string): string {
    try {
      return execSync(`git diff ${base}...HEAD`, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
      });
    } catch (error) {
      // Try without the three-dot syntax
      try {
        return execSync(`git diff ${base}..HEAD`, {
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
        });
      } catch {
        throw new Error(`Failed to get diff against ${base}: ${error}`);
      }
    }
  }

  /**
   * Get list of changed files.
   */
  private getChangedFiles(base: string): string[] {
    try {
      const output = execSync(`git diff --name-only ${base}...HEAD`, {
        encoding: 'utf8',
      });
      return output.trim().split('\n').filter(Boolean);
    } catch {
      // Try without three-dot syntax
      try {
        const output = execSync(`git diff --name-only ${base}..HEAD`, {
          encoding: 'utf8',
        });
        return output.trim().split('\n').filter(Boolean);
      } catch {
        return [];
      }
    }
  }

  /**
   * Run AI review using Claude CLI (claude command).
   */
  private async runAiReview(diff: string, files: string[]): Promise<{ issues: IReviewIssue[]; passed: string[] }> {
    // Check if claude CLI is available
    const claudeAvailable = this.isClaudeCliAvailable();
    
    if (!claudeAvailable) {
      throw new Error('Claude CLI not available. Install with: npm install -g @anthropic-ai/claude-code');
    }

    // Truncate diff if too large (context window limits)
    const maxDiffSize = 50000; // ~50KB should be safe
    let truncatedDiff = diff;
    let wasTruncated = false;
    if (diff.length > maxDiffSize) {
      truncatedDiff = diff.slice(0, maxDiffSize) + '\n\n... (diff truncated due to size)';
      wasTruncated = true;
    }

    // Create the review prompt
    const prompt = this.createReviewPrompt(truncatedDiff, files, wasTruncated);

    // Run claude CLI with the prompt
    try {
      const result = execSync(`claude -p "${prompt.replace(/"/g, '\\"')}"`, {
        encoding: 'utf8',
        maxBuffer: 5 * 1024 * 1024,
        timeout: 120000, // 2 minute timeout
      });

      return this.parseAiResponse(result);
    } catch (error) {
      // Claude CLI might not be installed or might fail
      // Try alternative: use a simple heuristic-based review
      return this.fallbackReview(diff, files);
    }
  }

  /**
   * Check if Claude CLI is available.
   */
  private isClaudeCliAvailable(): boolean {
    try {
      execSync('claude --version', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create the review prompt for the AI.
   */
  private createReviewPrompt(diff: string, files: string[], wasTruncated: boolean): string {
    const fileList = files.slice(0, 20).join(', ');
    const truncationNote = wasTruncated ? '\n\nNote: The diff was truncated due to size. Focus on what is visible.' : '';

    return `Review this code diff for a PR. Analyze for issues and categorize them.

Files changed: ${fileList}${files.length > 20 ? ` (and ${files.length - 20} more)` : ''}
${truncationNote}

DIFF:
${diff}

Respond in this exact JSON format:
{
  "issues": [
    {"severity": "critical|warning|suggestion", "file": "path/to/file.ts", "line": 42, "message": "Description of issue"}
  ],
  "passed": ["List of things that look good"]
}

Focus on:
- Critical: bugs, security vulnerabilities, data loss risks
- Warning: error handling gaps, performance issues, missing validation
- Suggestion: code style, readability improvements, best practices

Be concise. Only report real issues, not style preferences.`;
  }

  /**
   * Parse AI response into structured format.
   */
  private parseAiResponse(response: string): { issues: IReviewIssue[]; passed: string[] } {
    try {
      // Try to find JSON in the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          issues: Array.isArray(parsed.issues) ? parsed.issues.map((i: Record<string, unknown>) => ({
            severity: (i.severity as string) || 'suggestion',
            file: String(i.file || 'unknown'),
            line: typeof i.line === 'number' ? i.line : undefined,
            message: String(i.message || ''),
          })) : [],
          passed: Array.isArray(parsed.passed) ? parsed.passed.map(String) : [],
        };
      }
    } catch {
      // Parsing failed
    }

    // Fallback: return empty
    return { issues: [], passed: ['AI response could not be parsed'] };
  }

  /**
   * Fallback review using simple heuristics when AI is not available.
   */
  private fallbackReview(diff: string, files: string[]): { issues: IReviewIssue[]; passed: string[] } {
    const issues: IReviewIssue[] = [];
    const passed: string[] = [];

    // Simple pattern-based checks
    const lines = diff.split('\n');
    let currentFile = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track current file
      if (line.startsWith('+++ b/')) {
        currentFile = line.slice(6);
        continue;
      }

      // Only check added lines
      if (!line.startsWith('+') || line.startsWith('+++')) continue;

      const content = line.slice(1);

      // Check for console.log in production code
      if (content.includes('console.log') && !currentFile.includes('.test.') && !currentFile.includes('.spec.')) {
        issues.push({
          severity: 'warning',
          file: currentFile,
          message: 'console.log statement found - consider removing for production',
        });
      }

      // Check for TODO/FIXME comments
      if (content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/i)) {
        issues.push({
          severity: 'suggestion',
          file: currentFile,
          message: 'TODO/FIXME comment found - consider addressing before merge',
        });
      }

      // Check for potential secrets
      if (content.match(/password\s*=\s*['"][^'"]+['"]|api_?key\s*=\s*['"][^'"]+['"]|secret\s*=\s*['"][^'"]+['"]/i)) {
        issues.push({
          severity: 'critical',
          file: currentFile,
          message: 'Potential hardcoded secret detected - use environment variables',
        });
      }

      // Check for any type in TypeScript
      if (currentFile.endsWith('.ts') && content.includes(': any')) {
        issues.push({
          severity: 'warning',
          file: currentFile,
          message: 'Usage of "any" type - consider using a more specific type',
        });
      }
    }

    // Add some passed checks
    if (!issues.some(i => i.severity === 'critical')) {
      passed.push('No critical security issues detected');
    }
    
    const testFiles = files.filter(f => f.includes('.test.') || f.includes('.spec.'));
    if (testFiles.length > 0) {
      passed.push(`Test files included: ${testFiles.length} test file(s)`);
    }

    return { issues, passed };
  }
}
