#!/usr/bin/env node
/**
 * init-review.ts - Codebase analysis for Lisa
 *
 * Commands:
 *   node init-review.js run [--force]   - Run static analysis + queue AI enrichment
 *   node init-review.js show            - Show current init review from memory
 *   node init-review.js status          - Check if init review is done
 *
 * This runs automatically during npm install via postinstall.js
 */

export {}; // ensure module scope

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ============================================================================
// Types
// ============================================================================

interface ICodebaseInfo {
  isCodebase: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface IInitReviewResult {
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
}

// ============================================================================
// Group ID Utilities (inline to avoid import complexity)
// ============================================================================

const MAX_GROUP_ID_LENGTH = 128;

function normalizePathToGroupId(absolutePath: string): string {
  let normalized = absolutePath
    .toLowerCase()
    .replace(/^[a-z]:/i, (match: string) => match.charAt(0))
    .replace(/^\//, '')
    .replace(/\\/g, '-')
    .replace(/\//g, '-')
    .replace(/\./g, '_')
    .replace(/^-+/, '')
    .replace(/-+/g, '-');

  if (normalized.length > MAX_GROUP_ID_LENGTH) {
    normalized = normalized.slice(-MAX_GROUP_ID_LENGTH);
  }
  return normalized;
}

function getCurrentGroupId(cwd: string = process.cwd()): string {
  return normalizePathToGroupId(cwd);
}

// ============================================================================
// Detection Utilities
// ============================================================================

const PROJECT_FILES = {
  // High confidence - definite codebase
  high: [
    'package.json',
    'pyproject.toml',
    'setup.py',
    'requirements.txt',
    'Cargo.toml',
    'go.mod',
    'pom.xml',
    'build.gradle',
    'Gemfile',
    'composer.json',
    'Makefile',
    'CMakeLists.txt',
  ],
  // Medium confidence
  medium: [
    '.git',
    'src',
    'lib',
    'app',
    'README.md',
  ],
};

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.c': 'C',
  '.swift': 'Swift',
};

const FRAMEWORK_INDICATORS: Record<string, { files: string[]; deps: string[] }> = {
  'React': { files: [], deps: ['react', 'react-dom'] },
  'Next.js': { files: ['next.config.js', 'next.config.mjs'], deps: ['next'] },
  'Vue': { files: ['vue.config.js'], deps: ['vue'] },
  'Angular': { files: ['angular.json'], deps: ['@angular/core'] },
  'Express': { files: [], deps: ['express'] },
  'NestJS': { files: ['nest-cli.json'], deps: ['@nestjs/core'] },
  'FastAPI': { files: [], deps: ['fastapi'] },
  'Django': { files: ['manage.py'], deps: ['django'] },
  'Flask': { files: [], deps: ['flask'] },
  'Rails': { files: ['Gemfile'], deps: ['rails'] },
  'Spring': { files: [], deps: ['spring-boot'] },
};

const ARCHITECTURE_INDICATORS: Record<string, string[]> = {
  'clean-architecture': ['domain', 'application', 'infrastructure'],
  'mvc': ['models', 'views', 'controllers'],
  'hexagonal': ['adapters', 'ports', 'domain'],
  'monorepo': ['packages', 'apps', 'libs'],
  'microservices': ['services', 'gateway', 'shared'],
};

const TEST_DIRS = ['tests', 'test', '__tests__', 'spec', 'specs'];
const ENTRY_PATTERNS = ['index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js', 'cli.ts', 'cli.js', 'main.py', 'app.py', '__main__.py'];

// ============================================================================
// Analysis Functions
// ============================================================================

function isCodebase(projectRoot: string): ICodebaseInfo {
  // Check high confidence files
  for (const file of PROJECT_FILES.high) {
    const filePath = path.join(projectRoot, file);
    if (fs.existsSync(filePath)) {
      return { isCodebase: true, confidence: 'high', reason: `Found ${file}` };
    }
  }

  // Check medium confidence
  let mediumCount = 0;
  for (const file of PROJECT_FILES.medium) {
    const filePath = path.join(projectRoot, file);
    if (fs.existsSync(filePath)) {
      mediumCount++;
    }
  }

  if (mediumCount >= 2) {
    return { isCodebase: true, confidence: 'medium', reason: `Found ${mediumCount} indicators` };
  }

  // Check for code files
  try {
    const files = fs.readdirSync(projectRoot);
    const codeFiles = files.filter((f: string) => {
      const ext = path.extname(f);
      return LANGUAGE_EXTENSIONS[ext];
    });
    if (codeFiles.length >= 3) {
      return { isCodebase: true, confidence: 'medium', reason: `Found ${codeFiles.length} code files` };
    }
  } catch (_) {
    // ignore
  }

  return { isCodebase: false, confidence: 'low', reason: 'No codebase indicators found' };
}

function getProjectName(projectRoot: string): string {
  // Try package.json
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name) {
        return pkg.name.replace(/^@[^/]+\//, '');
      }
    } catch (_) {
    // Ignore errors
  }
  }

  // Try pyproject.toml
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf8');
      const match = content.match(/name\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    } catch (_) {
    // Ignore errors
  }
  }

  // Fall back to directory name
  return path.basename(projectRoot);
}

function scanDirectory(dir: string, maxDepth: number = 4, currentDepth: number = 0): { files: string[]; dirs: string[] } {
  const files: string[] = [];
  const dirs: string[] = [];

  if (currentDepth >= maxDepth) return { files, dirs };

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip common non-source directories and lisa scaffolding
      if (['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'venv', 'target', '.next', '.agents', '.claude', '.dev'].includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(process.cwd(), fullPath);

      if (entry.isDirectory()) {
        dirs.push(relativePath);
        const sub = scanDirectory(fullPath, maxDepth, currentDepth + 1);
        files.push(...sub.files);
        dirs.push(...sub.dirs);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  } catch (_) {
    // ignore permission errors
  }

  return { files, dirs };
}

function detectLanguages(files: string[]): string[] {
  const langCounts: Record<string, number> = {};

  for (const file of files) {
    const ext = path.extname(file);
    const lang = LANGUAGE_EXTENSIONS[ext];
    if (lang) {
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    }
  }

  // Sort by count
  return Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

function detectFrameworks(projectRoot: string, deps: string[]): string[] {
  const frameworks: string[] = [];

  for (const [framework, indicators] of Object.entries(FRAMEWORK_INDICATORS)) {
    // Check files
    for (const file of indicators.files) {
      if (fs.existsSync(path.join(projectRoot, file))) {
        frameworks.push(framework);
        break;
      }
    }

    // Check dependencies
    if (!frameworks.includes(framework)) {
      for (const dep of indicators.deps) {
        if (deps.includes(dep)) {
          frameworks.push(framework);
          break;
        }
      }
    }
  }

  return frameworks;
}

function detectArchitecture(dirs: string[]): string | null {
  const dirNames = dirs.map(d => path.basename(d).toLowerCase());

  for (const [arch, indicators] of Object.entries(ARCHITECTURE_INDICATORS)) {
    const matches = indicators.filter(ind => dirNames.includes(ind));
    if (matches.length >= 2) {
      return arch;
    }
  }

  return null;
}

function detectBuildTools(projectRoot: string): string[] {
  const tools: string[] = [];

  if (fs.existsSync(path.join(projectRoot, 'package.json'))) tools.push('npm');
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) tools.push('yarn');
  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) tools.push('pnpm');
  if (fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) tools.push('tsc');
  if (fs.existsSync(path.join(projectRoot, 'webpack.config.js'))) tools.push('webpack');
  if (fs.existsSync(path.join(projectRoot, 'vite.config.js')) || fs.existsSync(path.join(projectRoot, 'vite.config.ts'))) tools.push('vite');
  if (fs.existsSync(path.join(projectRoot, 'rollup.config.js'))) tools.push('rollup');
  if (fs.existsSync(path.join(projectRoot, 'Makefile'))) tools.push('make');
  if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) tools.push('cargo');
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) tools.push('go');
  if (fs.existsSync(path.join(projectRoot, 'pyproject.toml'))) tools.push('poetry');
  if (fs.existsSync(path.join(projectRoot, 'requirements.txt'))) tools.push('pip');

  return tools;
}

function getDependencies(projectRoot: string): { production: string[]; dev: string[]; all: string[] } {
  const production: string[] = [];
  const dev: string[] = [];

  // Try package.json
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.dependencies) {
        production.push(...Object.keys(pkg.dependencies));
      }
      if (pkg.devDependencies) {
        dev.push(...Object.keys(pkg.devDependencies));
      }
    } catch (_) {
    // Ignore errors
  }
  }

  // Try requirements.txt
  const reqPath = path.join(projectRoot, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    try {
      const content = fs.readFileSync(reqPath, 'utf8');
      const deps = content.split('\n')
        .map((l: string) => l.split('==')[0].split('>=')[0].trim())
        .filter((l: string) => l && !l.startsWith('#'));
      production.push(...deps);
    } catch (_) {
    // Ignore errors
  }
  }

  return { production, dev, all: [...production, ...dev] };
}

function findEntryPoints(projectRoot: string, _files: string[]): string[] {
  const entryPoints: string[] = [];

  // Check common entry point patterns
  for (const pattern of ENTRY_PATTERNS) {
    // Check root
    if (fs.existsSync(path.join(projectRoot, pattern))) {
      entryPoints.push(pattern);
    }
    // Check src/
    if (fs.existsSync(path.join(projectRoot, 'src', pattern))) {
      entryPoints.push(`src/${pattern}`);
    }
  }

  // Check package.json main/bin
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.main && !entryPoints.includes(pkg.main)) {
        entryPoints.push(pkg.main);
      }
      if (pkg.bin) {
        const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin);
        for (const bin of bins) {
          if (!entryPoints.includes(bin as string)) {
            entryPoints.push(bin as string);
          }
        }
      }
    } catch (_) {
    // Ignore errors
  }
  }

  return entryPoints.slice(0, 5); // Limit to 5
}

function findMainModules(dirs: string[]): string[] {
  const mainDirs = ['src', 'lib', 'app', 'domain', 'application', 'infrastructure', 'services', 'components', 'utils', 'core'];
  return dirs
    .filter(d => mainDirs.includes(path.basename(d)))
    .slice(0, 10);
}

function findTestDirs(dirs: string[]): string[] {
  return dirs
    .filter(d => TEST_DIRS.includes(path.basename(d)))
    .slice(0, 5);
}

function findConfigFiles(projectRoot: string): string[] {
  const configs = [
    'tsconfig.json', '.eslintrc.js', '.eslintrc.json', '.prettierrc',
    'jest.config.js', 'vitest.config.ts', '.env.example',
    'docker-compose.yml', 'Dockerfile', '.github/workflows'
  ];

  return configs.filter(c => fs.existsSync(path.join(projectRoot, c)));
}

function detectTesting(projectRoot: string, deps: string[]): string | null {
  if (deps.includes('jest')) return 'jest';
  if (deps.includes('vitest')) return 'vitest';
  if (deps.includes('mocha')) return 'mocha';
  if (deps.includes('pytest')) return 'pytest';
  if (fs.existsSync(path.join(projectRoot, 'jest.config.js'))) return 'jest';
  if (fs.existsSync(path.join(projectRoot, 'vitest.config.ts'))) return 'vitest';
  return null;
}

function detectFormatting(deps: string[]): string | null {
  if (deps.includes('prettier')) return 'prettier';
  if (deps.includes('eslint')) return 'eslint';
  if (deps.includes('black')) return 'black';
  return null;
}

function detectCI(projectRoot: string): string | null {
  if (fs.existsSync(path.join(projectRoot, '.github', 'workflows'))) return 'github-actions';
  if (fs.existsSync(path.join(projectRoot, '.gitlab-ci.yml'))) return 'gitlab-ci';
  if (fs.existsSync(path.join(projectRoot, 'Jenkinsfile'))) return 'jenkins';
  if (fs.existsSync(path.join(projectRoot, '.circleci'))) return 'circleci';
  return null;
}

function getNoteworthy(deps: string[]): string[] {
  const noteworthy = [
    // Databases
    'pg', 'mysql', 'mongodb', 'redis', 'neo4j-driver', 'prisma', 'typeorm', 'sequelize', 'mongoose',
    // Frameworks
    'express', 'fastify', 'koa', 'nestjs', 'next', 'react', 'vue', 'angular', 'svelte',
    // AI/ML
    'openai', '@anthropic-ai', 'langchain', 'tensorflow', 'pytorch',
    // Auth
    'passport', 'jsonwebtoken', 'bcrypt',
    // Testing
    'jest', 'vitest', 'playwright', 'cypress',
    // Build
    'webpack', 'vite', 'rollup', 'esbuild',
    // GraphQL
    'graphql', 'apollo', '@apollo/client',
  ];

  return deps.filter(d => noteworthy.some(n => d.includes(n))).slice(0, 10);
}

// ============================================================================
// Main Analysis
// ============================================================================

function runAnalysis(projectRoot: string): IInitReviewResult {
  const { files, dirs } = scanDirectory(projectRoot);
  const deps = getDependencies(projectRoot);
  const languages = detectLanguages(files);
  const frameworks = detectFrameworks(projectRoot, deps.all);
  const testDirs = findTestDirs(dirs);

  return {
    version: '1.0',
    timestamp: new Date().toISOString(),
    project: {
      name: getProjectName(projectRoot),
      path: projectRoot,
      groupId: getCurrentGroupId(projectRoot),
    },
    codebase: {
      language: languages[0] || 'Unknown',
      languages,
      framework: frameworks[0] || null,
      frameworks,
      buildTools: detectBuildTools(projectRoot),
    },
    structure: {
      entryPoints: findEntryPoints(projectRoot, files),
      mainModules: findMainModules(dirs),
      testDirs,
      configFiles: findConfigFiles(projectRoot),
    },
    dependencies: {
      count: deps.all.length,
      production: deps.production.slice(0, 10),
      dev: deps.dev.slice(0, 5),
      noteworthy: getNoteworthy(deps.all),
    },
    patterns: {
      architecture: detectArchitecture(dirs),
      testing: detectTesting(projectRoot, deps.all),
      formatting: detectFormatting(deps.all),
      ci: detectCI(projectRoot),
    },
    metrics: {
      fileCount: files.length,
      dirCount: dirs.length,
      hasTests: testDirs.length > 0,
      hasDocumentation: fs.existsSync(path.join(projectRoot, 'README.md')),
    },
  };
}

function generateSummary(result: IInitReviewResult): string {
  const parts: string[] = [];

  // Language and framework
  const framework = result.codebase.framework ? ` with ${result.codebase.framework}` : '';
  parts.push(`${result.codebase.language} project${framework}`);

  // Architecture
  if (result.patterns.architecture) {
    parts.push(`using ${result.patterns.architecture} pattern`);
  }

  // Build tools
  if (result.codebase.buildTools.length > 0) {
    parts.push(`Build: ${result.codebase.buildTools.join(', ')}`);
  }

  // Entry points
  if (result.structure.entryPoints.length > 0) {
    parts.push(`Entry: ${result.structure.entryPoints.slice(0, 3).join(', ')}`);
  }

  // Main modules
  if (result.structure.mainModules.length > 0) {
    parts.push(`Modules: ${result.structure.mainModules.slice(0, 4).join(', ')}`);
  }

  // Dependencies
  if (result.dependencies.noteworthy.length > 0) {
    parts.push(`Key deps: ${result.dependencies.noteworthy.slice(0, 5).join(', ')}`);
  }

  // Testing
  if (result.patterns.testing) {
    parts.push(`Testing: ${result.patterns.testing}`);
  }

  // Metrics
  parts.push(`${result.metrics.fileCount} files, ${result.metrics.dirCount} directories`);

  return parts.join('. ') + '.';
}

// ============================================================================
// Memory Storage
// ============================================================================

async function storeToMemory(summary: string, projectRoot: string): Promise<void> {
  const memoryScript = path.join(__dirname, '..', '..', 'memory', 'scripts', 'memory.js');

  if (!fs.existsSync(memoryScript)) {
    throw new Error('Memory script not found');
  }

  return new Promise((resolve, reject) => {
    const child = spawn('node', [
      memoryScript,
      'add',
      summary,
      '--type', 'init-review',
      '--tag', 'scope:codebase',
      '--cache',
    ], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('close', (code: number) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Memory storage failed: ${stderr || stdout}`));
      }
    });
  });
}

async function loadFromMemory(projectRoot: string): Promise<string | null> {
  const memoryScript = path.join(__dirname, '..', '..', 'memory', 'scripts', 'memory.js');

  if (!fs.existsSync(memoryScript)) {
    return null;
  }

  return new Promise((resolve) => {
    const child = spawn('node', [
      memoryScript,
      'load',
      '--query', 'init-review',
      '--limit', '1',
      '--cache',
    ], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });

    child.on('close', (code: number) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout);
          const facts = result.facts || [];
          if (facts.length > 0) {
            resolve(facts[0].fact || facts[0].name || null);
          } else {
            resolve(null);
          }
        } catch (_) {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });
  });
}

// ============================================================================
// Marker File
// ============================================================================

function getMarkerPath(projectRoot: string): string {
  return path.join(projectRoot, '.agents', '.init-review-done');
}

function readMarker(projectRoot: string): { done: boolean; enriched: boolean; timestamp: string | null } {
  const markerPath = getMarkerPath(projectRoot);
  if (!fs.existsSync(markerPath)) {
    return { done: false, enriched: false, timestamp: null };
  }

  try {
    const content = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    return {
      done: true,
      enriched: content.enriched || false,
      timestamp: content.timestamp || null,
    };
  } catch (_) {
    return { done: true, enriched: false, timestamp: null };
  }
}

function writeMarker(projectRoot: string, enriched: boolean = false): void {
  const markerPath = getMarkerPath(projectRoot);
  const content = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    groupId: getCurrentGroupId(projectRoot),
    enriched,
  };

  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify(content, null, 2));
}

function deleteMarker(projectRoot: string): void {
  const markerPath = getMarkerPath(projectRoot);
  if (fs.existsSync(markerPath)) {
    fs.unlinkSync(markerPath);
  }
}

// ============================================================================
// CLI Commands
// ============================================================================

async function commandRun(projectRoot: string, force: boolean): Promise<void> {
  // Check marker
  const marker = readMarker(projectRoot);
  if (marker.done && !force) {
    console.log(JSON.stringify({
      status: 'skipped',
      action: 'run',
      reason: 'Init review already done. Use --force to re-run.',
      timestamp: marker.timestamp,
    }, null, 2));
    return;
  }

  // Delete marker if forcing
  if (force) {
    deleteMarker(projectRoot);
  }

  // Check if codebase
  const codebaseInfo = isCodebase(projectRoot);
  if (!codebaseInfo.isCodebase) {
    console.log(JSON.stringify({
      status: 'skipped',
      action: 'run',
      reason: codebaseInfo.reason,
    }, null, 2));
    return;
  }

  // Run analysis
  const result = runAnalysis(projectRoot);
  const summary = generateSummary(result);

  // Store to memory
  try {
    await storeToMemory(summary, projectRoot);
  } catch (err) {
    // Log but don't fail
    console.error(`Warning: Could not store to memory: ${err instanceof Error ? err.message : err}`);
  }

  // Write marker (not enriched yet)
  writeMarker(projectRoot, false);

  // Save static analysis for AI enrichment worker
  const agentsDir = path.join(projectRoot, '.agents');
  const staticFile = path.join(agentsDir, '.init-review-static.json');
  try {
    fs.writeFileSync(staticFile, JSON.stringify({ summary, result }, null, 2));
  } catch (err) {
    console.error(`Warning: Could not save static analysis: ${err instanceof Error ? err.message : err}`);
  }

  // Spawn AI enrichment worker in background
  const enrichWorker = path.join(__dirname, 'ai-enrich.js');
  if (fs.existsSync(enrichWorker)) {
    try {
      // Use stdio: 'ignore' for cross-platform compatibility
      // The worker handles its own logging via fs.appendFileSync
      const child = spawn('node', [enrichWorker, projectRoot, agentsDir], {
        cwd: projectRoot,
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      });

      child.unref();
    } catch (err) {
      // Log but don't fail
      console.error(`Warning: Could not start AI enrichment: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Output result
  console.log(JSON.stringify({
    status: 'ok',
    action: 'run',
    result,
    summary,
    enrichmentQueued: fs.existsSync(path.join(__dirname, 'ai-enrich.js')),
  }, null, 2));
}

async function commandShow(projectRoot: string): Promise<void> {
  const marker = readMarker(projectRoot);

  if (!marker.done) {
    console.log(JSON.stringify({
      status: 'not_found',
      action: 'show',
      message: 'No init review found. Run with: node init-review.js run',
    }, null, 2));
    return;
  }

  // Try to load from memory
  const review = await loadFromMemory(projectRoot);

  console.log(JSON.stringify({
    status: 'ok',
    action: 'show',
    review: review || 'Init review stored but not found in memory',
    enriched: marker.enriched,
    timestamp: marker.timestamp,
  }, null, 2));
}

async function commandStatus(projectRoot: string): Promise<void> {
  const marker = readMarker(projectRoot);
  const codebaseInfo = isCodebase(projectRoot);

  console.log(JSON.stringify({
    status: 'ok',
    action: 'status',
    isCodebase: codebaseInfo.isCodebase,
    confidence: codebaseInfo.confidence,
    done: marker.done,
    enriched: marker.enriched,
    timestamp: marker.timestamp,
    groupId: getCurrentGroupId(projectRoot),
  }, null, 2));
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';
  const force = args.includes('--force');
  const projectRoot = process.cwd();

  try {
    switch (command) {
      case 'run':
        await commandRun(projectRoot, force);
        break;
      case 'show':
        await commandShow(projectRoot);
        break;
      case 'status':
        await commandStatus(projectRoot);
        break;
      default:
        console.log(JSON.stringify({
          status: 'error',
          error: `Unknown command: ${command}. Use run|show|status`,
        }, null, 2));
        process.exit(1);
    }
  } catch (err) {
    console.log(JSON.stringify({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    }, null, 2));
    process.exit(1);
  }
}

// Export for use by postinstall
module.exports = { isCodebase, runAnalysis, generateSummary, writeMarker };

main();
