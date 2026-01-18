/**
 * scanner/index.ts - Main scanner orchestration
 *
 * Coordinates project discovery, review, analysis, and fact storage
 * for the `lisa scan` command.
 */

import path from 'path';
import chalk from 'chalk';
import { discoverProjects } from './discovery';
import { reviewProjects, IProjectReview } from './reviewer';
import { analyzeRelationships, IAnalysisResult } from './analyzer';
import { generateFacts, storeFacts, cleanScanFacts } from './facts';

export interface IScanOptions {
  dryRun?: boolean;
  clean?: boolean;
  verbose?: boolean;
}

export interface IScanResult {
  success: boolean;
  rootPath: string;
  projectsFound: number;
  projectsReviewed: number;
  factsGenerated: number;
  factsStored: number;
  errors: string[];
  analysis?: IAnalysisResult;
}

/**
 * Format a review for display
 */
function formatReview(review: IProjectReview): string {
  if (!review.success || !review.analysis) {
    return `${review.project.name}: ${chalk.red('Failed')} - ${review.error || 'Unknown error'}`;
  }

  const parts: string[] = [];
  parts.push(chalk.cyan(review.project.name));
  parts.push(review.analysis.codebase.language);

  if (review.analysis.codebase.framework) {
    parts.push(review.analysis.codebase.framework);
  }

  if (review.analysis.patterns.architecture) {
    parts.push(review.analysis.patterns.architecture);
  }

  parts.push(`${review.analysis.metrics.fileCount} files`);

  return parts.join(', ');
}

/**
 * Run the full scan process
 */
export async function runScan(
  targetPath: string,
  options: IScanOptions = {}
): Promise<IScanResult> {
  const rootPath = path.resolve(targetPath);
  const result: IScanResult = {
    success: true,
    rootPath,
    projectsFound: 0,
    projectsReviewed: 0,
    factsGenerated: 0,
    factsStored: 0,
    errors: [],
  };

  console.log(chalk.bold(`\nScanning ${rootPath} (recursive)...\n`));

  // Phase 1: Discover projects
  console.log(chalk.bold('Discovering projects...'));
  const projects = await discoverProjects(rootPath);
  result.projectsFound = projects.length;

  if (projects.length === 0) {
    console.log(chalk.yellow('  No projects found'));
    result.success = false;
    result.errors.push('No projects found in the specified directory');
    return result;
  }

  for (const project of projects) {
    console.log(`  Found: ${chalk.cyan(project.path.replace(rootPath, '~'))}`);
  }
  console.log();

  // Phase 2: Review projects
  console.log(chalk.bold(`Running init-review on ${projects.length} projects...`));
  const reviews = await reviewProjects(projects, (current, total, project) => {
    process.stdout.write(`  [${current}/${total}] Reviewing ${project.name}...\r`);
  });
  console.log(); // Clear the progress line

  for (const review of reviews) {
    const status = review.success ? chalk.green('OK') : chalk.red('FAIL');
    console.log(`  [${status}] ${formatReview(review)}`);

    if (review.success && review.analysis && options.verbose) {
      if (review.analysis.structure.entryPoints.length > 0) {
        console.log(chalk.gray(`        Entry: ${review.analysis.structure.entryPoints.slice(0, 3).join(', ')}`));
      }
      if (review.analysis.dependencies.noteworthy.length > 0) {
        console.log(chalk.gray(`        Key deps: ${review.analysis.dependencies.noteworthy.slice(0, 5).join(', ')}`));
      }
    }
  }
  console.log();

  result.projectsReviewed = reviews.filter(r => r.success).length;

  // Phase 3: Analyze relationships
  console.log(chalk.bold('Analyzing relationships...'));
  const analysis = analyzeRelationships(reviews, rootPath);
  result.analysis = analysis;

  // Show relationships found
  const internalDeps = analysis.relationships.filter(r => r.type === 'depends_on');
  if (internalDeps.length > 0) {
    for (const rel of internalDeps) {
      console.log(`  - ${rel.source} ${chalk.yellow('depends on')} ${rel.target}`);
    }
  }

  if (analysis.sharedStack.languages.length > 0) {
    console.log(`  - Shared stack: ${analysis.sharedStack.languages.join(', ')}`);
  }

  if (analysis.commonPatterns.architecture.length > 0) {
    for (const pattern of analysis.commonPatterns.architecture) {
      console.log(`  - Common pattern: ${pattern.pattern} (${pattern.projects.length} projects)`);
    }
  }
  console.log();

  // Phase 4: Generate facts
  const facts = generateFacts(analysis, rootPath);
  result.factsGenerated = facts.length;

  if (options.dryRun) {
    console.log(chalk.bold(chalk.yellow('Dry run - facts that would be stored:')));
    for (const fact of facts) {
      console.log(`  [${fact.type}] ${fact.text.slice(0, 80)}...`);
    }
    console.log();
    console.log(chalk.yellow(`Would store ${facts.length} facts to group.`));
    return result;
  }

  // Phase 5: Store facts
  if (options.clean) {
    console.log(chalk.dim('Cleaning existing scan facts...'));
    await cleanScanFacts(rootPath);
  }

  console.log(chalk.bold(`Storing ${facts.length} facts...`));
  const storageResult = await storeFacts(facts, rootPath, (current, total, fact) => {
    console.log(`  [${current}/${total}] ${fact.type}: ${fact.text.slice(0, 60)}...`);
  });

  result.factsStored = storageResult.factsStored;
  if (!storageResult.success) {
    result.errors.push(...storageResult.errors);
  }
  console.log();

  // Summary
  if (result.errors.length > 0) {
    result.success = false;
    console.log(chalk.red(`\nCompleted with ${result.errors.length} error(s):`));
    for (const error of result.errors.slice(0, 5)) {
      console.log(chalk.red(`  - ${error}`));
    }
  } else {
    console.log(chalk.green(`\nDone! ${result.factsStored} facts stored.`));
    console.log(chalk.dim('When working in any sub-repo, Lisa will include this solution context.'));
  }

  return result;
}

// Re-export types for CLI usage
export type { IDiscoveredProject } from './discovery';
export type { IProjectReview } from './reviewer';
export type { IAnalysisResult, IRelationship } from './analyzer';
export type { IFact, IStorageResult } from './facts';
