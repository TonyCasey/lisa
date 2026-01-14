/**
 * analyzer.ts - Analyze cross-repo relationships
 *
 * Identifies patterns across projects:
 * - Internal dependencies (repo A depends on repo B)
 * - Shared dependencies
 * - Common tech stack
 * - Architecture patterns
 */

import { IProjectReview } from './reviewer';

export interface IRelationship {
  type: 'depends_on' | 'shared_dependency' | 'shared_stack' | 'shared_pattern';
  source?: string;
  target?: string;
  description: string;
  projects?: string[];
}

export interface IAnalysisResult {
  solutionOverview: string;
  projectSummaries: Array<{
    name: string;
    path: string;
    summary: string;
    language: string;
    framework: string | null;
    architecture: string | null;
    fileCount: number;
  }>;
  relationships: IRelationship[];
  sharedStack: {
    languages: string[];
    frameworks: string[];
    buildTools: string[];
    testingFrameworks: string[];
  };
  commonPatterns: {
    architecture: Array<{ pattern: string; projects: string[] }>;
    testing: Array<{ framework: string; projects: string[] }>;
  };
}

/**
 * Find internal dependencies (repo A depends on repo B)
 */
function findInternalDependencies(reviews: IProjectReview[]): IRelationship[] {
  const relationships: IRelationship[] = [];
  const projectNames = new Set(reviews.map(r => r.project.name.toLowerCase()));

  for (const review of reviews) {
    if (!review.success || !review.analysis) continue;

    const allDeps = [
      ...review.analysis.dependencies.production,
      ...review.analysis.dependencies.dev,
    ];

    for (const dep of allDeps) {
      const depLower = dep.toLowerCase();
      // Check if this dependency matches another project name
      if (projectNames.has(depLower) && depLower !== review.project.name.toLowerCase()) {
        // Find the target project
        const targetProject = reviews.find(
          r => r.project.name.toLowerCase() === depLower
        );
        if (targetProject) {
          relationships.push({
            type: 'depends_on',
            source: review.project.name,
            target: targetProject.project.name,
            description: `${review.project.name} depends on ${targetProject.project.name}`,
          });
        }
      }
    }
  }

  return relationships;
}

/**
 * Find shared dependencies across projects
 */
function findSharedDependencies(reviews: IProjectReview[]): IRelationship[] {
  const relationships: IRelationship[] = [];
  const depCounts: Map<string, string[]> = new Map();

  // Notable dependencies to track
  const notableDeps = new Set([
    // Frameworks
    'react', 'vue', 'angular', 'express', 'fastify', 'nestjs', 'next',
    // Databases
    'pg', 'mysql', 'mongodb', 'redis', 'prisma', 'typeorm', 'sequelize',
    // Testing
    'jest', 'vitest', 'mocha', 'cypress', 'playwright',
    // Build tools
    'webpack', 'vite', 'rollup', 'esbuild',
    // Utilities
    'lodash', 'axios', 'dayjs', 'date-fns', 'zod', 'joi',
    // Auth
    'passport', 'jsonwebtoken', 'bcrypt',
  ]);

  for (const review of reviews) {
    if (!review.success || !review.analysis) continue;

    const allDeps = [
      ...review.analysis.dependencies.production,
      ...review.analysis.dependencies.noteworthy,
    ];

    for (const dep of allDeps) {
      const depLower = dep.toLowerCase();
      if (notableDeps.has(depLower)) {
        const projects = depCounts.get(depLower) || [];
        if (!projects.includes(review.project.name)) {
          projects.push(review.project.name);
          depCounts.set(depLower, projects);
        }
      }
    }
  }

  // Find dependencies shared by 2+ projects
  for (const [dep, projects] of depCounts) {
    if (projects.length >= 2) {
      relationships.push({
        type: 'shared_dependency',
        description: `${projects.join(', ')} share dependency: ${dep}`,
        projects,
        target: dep,
      });
    }
  }

  return relationships;
}

/**
 * Identify shared tech stack
 */
function analyzeSharedStack(reviews: IProjectReview[]): IAnalysisResult['sharedStack'] {
  const languages: Map<string, number> = new Map();
  const frameworks: Map<string, number> = new Map();
  const buildTools: Map<string, number> = new Map();
  const testingFrameworks: Map<string, number> = new Map();

  for (const review of reviews) {
    if (!review.success || !review.analysis) continue;

    // Languages
    for (const lang of review.analysis.codebase.languages) {
      languages.set(lang, (languages.get(lang) || 0) + 1);
    }

    // Frameworks
    for (const fw of review.analysis.codebase.frameworks) {
      frameworks.set(fw, (frameworks.get(fw) || 0) + 1);
    }

    // Build tools
    for (const tool of review.analysis.codebase.buildTools) {
      buildTools.set(tool, (buildTools.get(tool) || 0) + 1);
    }

    // Testing
    if (review.analysis.patterns.testing) {
      testingFrameworks.set(
        review.analysis.patterns.testing,
        (testingFrameworks.get(review.analysis.patterns.testing) || 0) + 1
      );
    }
  }

  // Return items that appear in 2+ projects, sorted by frequency
  const filterCommon = (map: Map<string, number>): string[] =>
    Array.from(map.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([item]) => item);

  return {
    languages: filterCommon(languages),
    frameworks: filterCommon(frameworks),
    buildTools: filterCommon(buildTools),
    testingFrameworks: filterCommon(testingFrameworks),
  };
}

/**
 * Find common patterns across projects
 */
function findCommonPatterns(reviews: IProjectReview[]): IAnalysisResult['commonPatterns'] {
  const architecture: Map<string, string[]> = new Map();
  const testing: Map<string, string[]> = new Map();

  for (const review of reviews) {
    if (!review.success || !review.analysis) continue;

    // Architecture patterns
    if (review.analysis.patterns.architecture) {
      const projects = architecture.get(review.analysis.patterns.architecture) || [];
      projects.push(review.project.name);
      architecture.set(review.analysis.patterns.architecture, projects);
    }

    // Testing frameworks
    if (review.analysis.patterns.testing) {
      const projects = testing.get(review.analysis.patterns.testing) || [];
      projects.push(review.project.name);
      testing.set(review.analysis.patterns.testing, projects);
    }
  }

  return {
    architecture: Array.from(architecture.entries())
      .filter(([, projects]) => projects.length >= 2)
      .map(([pattern, projects]) => ({ pattern, projects })),
    testing: Array.from(testing.entries())
      .filter(([, projects]) => projects.length >= 2)
      .map(([framework, projects]) => ({ framework, projects })),
  };
}

/**
 * Generate solution overview
 */
function generateSolutionOverview(reviews: IProjectReview[], rootPath: string): string {
  const successfulReviews = reviews.filter(r => r.success && r.analysis);
  const languageCounts: Map<string, number> = new Map();

  for (const review of successfulReviews) {
    if (review.analysis) {
      const lang = review.analysis.codebase.language;
      languageCounts.set(lang, (languageCounts.get(lang) || 0) + 1);
    }
  }

  const primaryLanguage = Array.from(languageCounts.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

  const projectNames = successfulReviews.map(r => r.project.name);
  const folderName = rootPath.split('/').pop() || rootPath;

  return `Solution in ${folderName}: ${successfulReviews.length} ${primaryLanguage} projects (${projectNames.join(', ')})`;
}

/**
 * Generate project summaries
 */
function generateProjectSummaries(reviews: IProjectReview[]): IAnalysisResult['projectSummaries'] {
  return reviews
    .filter(r => r.success && r.analysis)
    .map(review => ({
      name: review.project.name,
      path: review.project.path,
      summary: review.summary || 'No summary available',
      language: review.analysis?.codebase.language || 'Unknown',
      framework: review.analysis?.codebase.framework || null,
      architecture: review.analysis?.patterns.architecture || null,
      fileCount: review.analysis?.metrics.fileCount || 0,
    }));
}

/**
 * Analyze all projects and their relationships
 */
export function analyzeRelationships(
  reviews: IProjectReview[],
  rootPath: string
): IAnalysisResult {
  const internalDeps = findInternalDependencies(reviews);
  const sharedDeps = findSharedDependencies(reviews);
  const sharedStack = analyzeSharedStack(reviews);
  const commonPatterns = findCommonPatterns(reviews);

  // Build stack-related relationships
  const stackRelationships: IRelationship[] = [];

  if (sharedStack.languages.length > 0) {
    stackRelationships.push({
      type: 'shared_stack',
      description: `All projects use: ${sharedStack.languages.join(', ')}`,
      projects: reviews.filter(r => r.success).map(r => r.project.name),
    });
  }

  if (sharedStack.testingFrameworks.length > 0) {
    stackRelationships.push({
      type: 'shared_stack',
      description: `Testing: ${sharedStack.testingFrameworks.join(', ')}`,
      projects: reviews.filter(r => r.success).map(r => r.project.name),
    });
  }

  // Build pattern relationships
  const patternRelationships: IRelationship[] = commonPatterns.architecture.map(({ pattern, projects }) => ({
    type: 'shared_pattern' as const,
    description: `${projects.join(', ')} use ${pattern} architecture`,
    projects,
  }));

  return {
    solutionOverview: generateSolutionOverview(reviews, rootPath),
    projectSummaries: generateProjectSummaries(reviews),
    relationships: [
      ...internalDeps,
      ...sharedDeps,
      ...stackRelationships,
      ...patternRelationships,
    ],
    sharedStack,
    commonPatterns,
  };
}
