/**
 * reviewer.ts - Run init-review on discovered projects
 *
 * Leverages Lisa's existing init-review facility for rich project analysis.
 * Checks for cached analysis first, runs fresh analysis if needed.
 */

import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import { IDiscoveredProject } from './discovery';

export interface IProjectReview {
  project: IDiscoveredProject;
  success: boolean;
  error?: string;
  analysis?: {
    version: string;
    timestamp: string;
    project: {
      name: string;
      path: string;
      groupId: string;
    };
    codebase: {
      language: string;
      languages: string[];
      framework: string | null;
      frameworks: string[];
      buildTools: string[];
    };
    structure: {
      entryPoints: string[];
      mainModules: string[];
      testDirs: string[];
      configFiles: string[];
    };
    dependencies: {
      count: number;
      production: string[];
      dev: string[];
      noteworthy: string[];
    };
    patterns: {
      architecture: string | null;
      testing: string | null;
      formatting: string | null;
      ci: string | null;
    };
    metrics: {
      fileCount: number;
      dirCount: number;
      hasTests: boolean;
      hasDocumentation: boolean;
    };
  };
  summary?: string;
}

/**
 * Try to read cached init-review analysis
 */
async function readCachedAnalysis(projectPath: string): Promise<{
  analysis: IProjectReview['analysis'];
  summary: string;
} | null> {
  const staticFile = path.join(projectPath, '.lisa', '.init-review-static.json');

  if (await fs.pathExists(staticFile)) {
    try {
      const data = await fs.readJson(staticFile);
      if (data.result && data.summary) {
        return {
          analysis: data.result,
          summary: data.summary,
        };
      }
    } catch {
      // Ignore parse errors
    }
  }

  return null;
}

/**
 * Run init-review.js on a project and capture output
 */
async function runInitReview(projectPath: string): Promise<{
  analysis: IProjectReview['analysis'];
  summary: string;
} | null> {
  // Look for init-review script in the project's .lisa folder
  // or in our dist/project location
  const possiblePaths = [
    path.join(projectPath, '.lisa', 'skills', 'review', 'scripts', 'init-review.js'),
    path.join(__dirname, '..', '..', 'project', '.lisa', 'skills', 'review', 'scripts', 'init-review.js'),
  ];

  let scriptPath: string | null = null;
  for (const p of possiblePaths) {
    if (await fs.pathExists(p)) {
      scriptPath = p;
      break;
    }
  }

  // If no script found, try to run inline analysis
  if (!scriptPath) {
    return runInlineAnalysis(projectPath);
  }

  return new Promise((resolve) => {
    const TIMEOUT_MS = 30000;
    let resolved = false;
    
    const child = spawn('node', [scriptPath, 'run', '--force'], {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Manual timeout since spawn's timeout option is ignored by Node
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill('SIGTERM');
        resolve(runInlineAnalysis(projectPath));
      }
    }, TIMEOUT_MS);

    let stdout = '';
    let _stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      _stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (resolved) return;
      resolved = true;
      
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          if (result.status === 'ok' && result.result) {
            resolve({
              analysis: result.result,
              summary: result.summary || generateFallbackSummary(result.result),
            });
            return;
          }
        } catch {
          // Parse error, fall back to inline analysis
        }
      }
      // Failed, try inline analysis
      resolve(runInlineAnalysis(projectPath));
    });

    child.on('error', () => {
      clearTimeout(timeoutId);
      if (resolved) return;
      resolved = true;
      resolve(runInlineAnalysis(projectPath));
    });
  });
}

/**
 * Inline analysis for projects without init-review script
 * Provides basic analysis based on manifest files
 */
async function runInlineAnalysis(projectPath: string): Promise<{
  analysis: IProjectReview['analysis'];
  summary: string;
} | null> {
  try {
    const name = path.basename(projectPath);
    let language = 'Unknown';
    let framework: string | null = null;
    const frameworks: string[] = [];
    const buildTools: string[] = [];
    const dependencies: string[] = [];
    const devDependencies: string[] = [];

    // Check package.json
    const pkgPath = path.join(projectPath, 'package.json');
    if (await fs.pathExists(pkgPath)) {
      const pkg = await fs.readJson(pkgPath);
      language = (await fs.pathExists(path.join(projectPath, 'tsconfig.json'))) ? 'TypeScript' : 'JavaScript';

      if (pkg.dependencies) {
        dependencies.push(...Object.keys(pkg.dependencies));
        if (pkg.dependencies.react) frameworks.push('React');
        if (pkg.dependencies.next) frameworks.push('Next.js');
        if (pkg.dependencies.vue) frameworks.push('Vue');
        if (pkg.dependencies.express) frameworks.push('Express');
        if (pkg.dependencies['@nestjs/core']) frameworks.push('NestJS');
      }
      if (pkg.devDependencies) {
        devDependencies.push(...Object.keys(pkg.devDependencies));
      }

      buildTools.push('npm');
      if (await fs.pathExists(path.join(projectPath, 'tsconfig.json'))) buildTools.push('tsc');
    }

    // Check pyproject.toml
    if (await fs.pathExists(path.join(projectPath, 'pyproject.toml'))) {
      language = 'Python';
      buildTools.push('poetry');
    }

    // Check Cargo.toml
    if (await fs.pathExists(path.join(projectPath, 'Cargo.toml'))) {
      language = 'Rust';
      buildTools.push('cargo');
    }

    // Check go.mod
    if (await fs.pathExists(path.join(projectPath, 'go.mod'))) {
      language = 'Go';
      buildTools.push('go');
    }

    framework = frameworks[0] || null;

    const analysis: IProjectReview['analysis'] = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      project: {
        name,
        path: projectPath,
        groupId: normalizePathToGroupId(projectPath),
      },
      codebase: {
        language,
        languages: [language],
        framework,
        frameworks,
        buildTools,
      },
      structure: {
        entryPoints: [],
        mainModules: [],
        testDirs: [],
        configFiles: [],
      },
      dependencies: {
        count: dependencies.length + devDependencies.length,
        production: dependencies.slice(0, 10),
        dev: devDependencies.slice(0, 5),
        noteworthy: [],
      },
      patterns: {
        architecture: null,
        testing: null,
        formatting: null,
        ci: null,
      },
      metrics: {
        fileCount: 0,
        dirCount: 0,
        hasTests: false,
        hasDocumentation: await fs.pathExists(path.join(projectPath, 'README.md')),
      },
    };

    const summary = generateFallbackSummary(analysis);

    return { analysis, summary };
  } catch {
    return null;
  }
}

/**
 * Generate a summary from analysis data
 */
function generateFallbackSummary(analysis: IProjectReview['analysis']): string {
  if (!analysis) return 'Unknown project';

  const parts: string[] = [];

  const framework = analysis.codebase.framework ? ` with ${analysis.codebase.framework}` : '';
  parts.push(`${analysis.codebase.language} project${framework}`);

  if (analysis.patterns.architecture) {
    parts.push(`using ${analysis.patterns.architecture} pattern`);
  }

  if (analysis.codebase.buildTools.length > 0) {
    parts.push(`Build: ${analysis.codebase.buildTools.join(', ')}`);
  }

  if (analysis.dependencies.noteworthy.length > 0) {
    parts.push(`Key deps: ${analysis.dependencies.noteworthy.slice(0, 5).join(', ')}`);
  }

  return parts.join('. ') + '.';
}

/**
 * Normalize path to group ID (copied from init-review for consistency)
 */
function normalizePathToGroupId(absolutePath: string): string {
  let normalized = absolutePath
    .toLowerCase()
    .replace(/^[a-z]:/i, (match) => match.charAt(0))
    .replace(/^\//, '')
    .replace(/\\/g, '-')
    .replace(/\//g, '-')
    .replace(/\./g, '_')
    .replace(/^-+/, '')
    .replace(/-+/g, '-');

  if (normalized.length > 128) {
    normalized = normalized.slice(-128);
  }
  return normalized;
}

/**
 * Review a single project
 */
export async function reviewProject(project: IDiscoveredProject): Promise<IProjectReview> {
  try {
    // First, try to read cached analysis
    const cached = await readCachedAnalysis(project.path);
    if (cached) {
      return {
        project,
        success: true,
        analysis: cached.analysis,
        summary: cached.summary,
      };
    }

    // Run fresh analysis
    const result = await runInitReview(project.path);
    if (result) {
      return {
        project,
        success: true,
        analysis: result.analysis,
        summary: result.summary,
      };
    }

    return {
      project,
      success: false,
      error: 'Analysis returned no results',
    };
  } catch (err) {
    return {
      project,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Review multiple projects with progress callback
 */
export async function reviewProjects(
  projects: IDiscoveredProject[],
  onProgress?: (current: number, total: number, project: IDiscoveredProject) => void
): Promise<IProjectReview[]> {
  const reviews: IProjectReview[] = [];

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    if (onProgress) {
      onProgress(i + 1, projects.length, project);
    }

    const review = await reviewProject(project);
    reviews.push(review);
  }

  return reviews;
}
