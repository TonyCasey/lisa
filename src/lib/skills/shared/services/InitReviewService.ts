/**
 * Init Review service - codebase analysis and memory storage.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// ============================================================================
// Types
// ============================================================================

export interface ICodebaseInfo {
  isCodebase: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface IInitReviewResult {
  version: string;
  timestamp: string;
  project: { name: string; path: string; groupId: string };
  codebase: { language: string; languages: string[]; framework: string | null; frameworks: string[]; buildTools: string[] };
  structure: { entryPoints: string[]; mainModules: string[]; testDirs: string[]; configFiles: string[] };
  dependencies: { count: number; production: string[]; dev: string[]; noteworthy: string[] };
  patterns: { architecture: string | null; testing: string | null; formatting: string | null; ci: string | null };
  metrics: { fileCount: number; dirCount: number; hasTests: boolean; hasDocumentation: boolean };
}

export interface IMarkerInfo {
  done: boolean;
  enriched: boolean;
  timestamp: string | null;
}

export interface IInitReviewService {
  normalizePathToGroupId(absolutePath: string): string;
  getCurrentGroupId(cwd?: string): string;
  isCodebase(projectRoot: string): ICodebaseInfo;
  runAnalysis(projectRoot: string): IInitReviewResult;
  generateSummary(result: IInitReviewResult): string;
  readMarker(projectRoot: string): IMarkerInfo;
  writeMarker(projectRoot: string, enriched?: boolean): void;
  deleteMarker(projectRoot: string): void;
  storeToMemory(summary: string, projectRoot: string): Promise<void>;
  loadFromMemory(projectRoot: string): Promise<string | null>;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_GROUP_ID_LENGTH = 128;

const PROJECT_FILES = {
  high: ['package.json', 'pyproject.toml', 'setup.py', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json', 'Makefile', 'CMakeLists.txt'],
  medium: ['.git', 'src', 'lib', 'app', 'README.md'],
};

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin',
  '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#', '.cpp': 'C++', '.c': 'C', '.swift': 'Swift',
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
};

const ARCHITECTURE_INDICATORS: Record<string, string[]> = {
  'clean-architecture': ['domain', 'application', 'infrastructure'],
  'mvc': ['models', 'views', 'controllers'],
  'hexagonal': ['adapters', 'ports', 'domain'],
  'monorepo': ['packages', 'apps', 'libs'],
};

const TEST_DIRS = ['tests', 'test', '__tests__', 'spec', 'specs'];
const _ENTRY_PATTERNS = ['index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js', 'cli.ts', 'cli.js', 'main.py', 'app.py'];
void _ENTRY_PATTERNS; // Reserved for future use

/**
 * Creates an init review service instance.
 */
export function createInitReviewService(): IInitReviewService {
  function scanDirectory(dir: string, maxDepth: number = 4, currentDepth: number = 0): { files: string[]; dirs: string[] } {
    const files: string[] = [];
    const dirs: string[] = [];
    if (currentDepth >= maxDepth) return { files, dirs };

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'target', '.next', '.lisa', '.claude'].includes(entry.name)) continue;

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
    } catch { /* ignore */ }

    return { files, dirs };
  }

  function detectLanguages(files: string[]): string[] {
    const langCounts: Record<string, number> = {};
    for (const file of files) {
      const ext = path.extname(file);
      const lang = LANGUAGE_EXTENSIONS[ext];
      if (lang) langCounts[lang] = (langCounts[lang] || 0) + 1;
    }
    return Object.entries(langCounts).sort((a, b) => b[1] - a[1]).map(([lang]) => lang);
  }

  function detectFrameworks(projectRoot: string, deps: string[]): string[] {
    const frameworks: string[] = [];
    for (const [framework, indicators] of Object.entries(FRAMEWORK_INDICATORS)) {
      for (const file of indicators.files) {
        if (fs.existsSync(path.join(projectRoot, file))) { frameworks.push(framework); break; }
      }
      if (!frameworks.includes(framework)) {
        for (const dep of indicators.deps) {
          if (deps.includes(dep)) { frameworks.push(framework); break; }
        }
      }
    }
    return frameworks;
  }

  function getDependencies(projectRoot: string): { production: string[]; dev: string[]; all: string[] } {
    const production: string[] = [];
    const dev: string[] = [];

    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.dependencies) production.push(...Object.keys(pkg.dependencies));
        if (pkg.devDependencies) dev.push(...Object.keys(pkg.devDependencies));
      } catch { /* ignore */ }
    }

    return { production, dev, all: [...production, ...dev] };
  }

  function getMarkerPath(projectRoot: string): string {
    return path.join(projectRoot, '.lisa', '.init-review-done');
  }

  return {
    normalizePathToGroupId(absolutePath: string): string {
      let normalized = absolutePath
        .toLowerCase()
        .replace(/^[a-z]:/i, (m) => m.charAt(0))
        .replace(/^\//, '')
        .replace(/\\/g, '-')
        .replace(/\//g, '-')
        .replace(/\./g, '_')
        .replace(/^-+/, '')
        .replace(/-+/g, '-');
      if (normalized.length > MAX_GROUP_ID_LENGTH) normalized = normalized.slice(-MAX_GROUP_ID_LENGTH);
      return normalized;
    },

    getCurrentGroupId(cwd: string = process.cwd()): string {
      return this.normalizePathToGroupId(cwd);
    },

    isCodebase(projectRoot: string): ICodebaseInfo {
      for (const file of PROJECT_FILES.high) {
        if (fs.existsSync(path.join(projectRoot, file))) {
          return { isCodebase: true, confidence: 'high', reason: `Found ${file}` };
        }
      }

      let mediumCount = 0;
      for (const file of PROJECT_FILES.medium) {
        if (fs.existsSync(path.join(projectRoot, file))) mediumCount++;
      }
      if (mediumCount >= 2) {
        return { isCodebase: true, confidence: 'medium', reason: `Found ${mediumCount} indicators` };
      }

      return { isCodebase: false, confidence: 'low', reason: 'No codebase indicators found' };
    },

    runAnalysis(projectRoot: string): IInitReviewResult {
      const { files, dirs } = scanDirectory(projectRoot);
      const deps = getDependencies(projectRoot);
      const languages = detectLanguages(files);
      const frameworks = detectFrameworks(projectRoot, deps.all);
      const testDirs = dirs.filter(d => TEST_DIRS.includes(path.basename(d))).slice(0, 5);

      const pkgPath = path.join(projectRoot, 'package.json');
      let projectName = path.basename(projectRoot);
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg.name) projectName = pkg.name.replace(/^@[^/]+\//, '');
        } catch { /* ignore */ }
      }

      const mainDirs = ['src', 'lib', 'app', 'domain', 'application', 'infrastructure', 'services'];
      const mainModules = dirs.filter(d => mainDirs.includes(path.basename(d))).slice(0, 10);

      const buildTools: string[] = [];
      if (fs.existsSync(path.join(projectRoot, 'package.json'))) buildTools.push('npm');
      if (fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) buildTools.push('tsc');

      const dirNames = dirs.map(d => path.basename(d).toLowerCase());
      let architecture: string | null = null;
      for (const [arch, indicators] of Object.entries(ARCHITECTURE_INDICATORS)) {
        if (indicators.filter(ind => dirNames.includes(ind)).length >= 2) { architecture = arch; break; }
      }

      return {
        version: '1.0',
        timestamp: new Date().toISOString(),
        project: { name: projectName, path: projectRoot, groupId: this.getCurrentGroupId(projectRoot) },
        codebase: { language: languages[0] || 'Unknown', languages, framework: frameworks[0] || null, frameworks, buildTools },
        structure: { entryPoints: [], mainModules, testDirs, configFiles: [] },
        dependencies: { count: deps.all.length, production: deps.production.slice(0, 10), dev: deps.dev.slice(0, 5), noteworthy: [] },
        patterns: { architecture, testing: deps.all.includes('jest') ? 'jest' : null, formatting: deps.all.includes('prettier') ? 'prettier' : null, ci: fs.existsSync(path.join(projectRoot, '.github', 'workflows')) ? 'github-actions' : null },
        metrics: { fileCount: files.length, dirCount: dirs.length, hasTests: testDirs.length > 0, hasDocumentation: fs.existsSync(path.join(projectRoot, 'README.md')) },
      };
    },

    generateSummary(result: IInitReviewResult): string {
      const parts: string[] = [];
      const framework = result.codebase.framework ? ` with ${result.codebase.framework}` : '';
      parts.push(`${result.codebase.language} project${framework}`);
      if (result.patterns.architecture) parts.push(`using ${result.patterns.architecture} pattern`);
      if (result.codebase.buildTools.length > 0) parts.push(`Build: ${result.codebase.buildTools.join(', ')}`);
      if (result.structure.mainModules.length > 0) parts.push(`Modules: ${result.structure.mainModules.slice(0, 4).join(', ')}`);
      if (result.patterns.testing) parts.push(`Testing: ${result.patterns.testing}`);
      parts.push(`${result.metrics.fileCount} files, ${result.metrics.dirCount} directories`);
      return parts.join('. ') + '.';
    },

    readMarker(projectRoot: string): IMarkerInfo {
      const markerPath = getMarkerPath(projectRoot);
      if (!fs.existsSync(markerPath)) return { done: false, enriched: false, timestamp: null };

      try {
        const content = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        return { done: true, enriched: content.enriched || false, timestamp: content.timestamp || null };
      } catch {
        return { done: true, enriched: false, timestamp: null };
      }
    },

    writeMarker(projectRoot: string, enriched: boolean = false): void {
      const markerPath = getMarkerPath(projectRoot);
      const content = { version: '1.0', timestamp: new Date().toISOString(), groupId: this.getCurrentGroupId(projectRoot), enriched };
      fs.mkdirSync(path.dirname(markerPath), { recursive: true });
      fs.writeFileSync(markerPath, JSON.stringify(content, null, 2));
    },

    deleteMarker(projectRoot: string): void {
      const markerPath = getMarkerPath(projectRoot);
      if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
    },

    async storeToMemory(summary: string, projectRoot: string): Promise<void> {
      const memoryScript = path.join(__dirname, '..', '..', 'memory', 'scripts', 'memory.js');
      if (!fs.existsSync(memoryScript)) throw new Error('Memory script not found');

      return new Promise((resolve, reject) => {
        const child = spawn('node', [memoryScript, 'add', summary, '--type', 'init-review', '--tag', 'scope:codebase', '--cache'], {
          cwd: projectRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        child.on('close', (code: number) => {
          if (code === 0) resolve();
          else reject(new Error(`Memory storage failed: ${stderr}`));
        });
      });
    },

    async loadFromMemory(projectRoot: string): Promise<string | null> {
      const memoryScript = path.join(__dirname, '..', '..', 'memory', 'scripts', 'memory.js');
      if (!fs.existsSync(memoryScript)) return null;

      return new Promise((resolve) => {
        const child = spawn('node', [memoryScript, 'load', '--query', 'init-review', '--limit', '1', '--cache'], {
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
              resolve(facts.length > 0 ? (facts[0].fact || facts[0].name || null) : null);
            } catch { resolve(null); }
          } else { resolve(null); }
        });
      });
    },
  };
}
