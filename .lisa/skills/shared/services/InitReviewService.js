"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInitReviewService = createInitReviewService;
/**
 * Init Review service - codebase analysis and memory storage.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
// ============================================================================
// Constants
// ============================================================================
const MAX_GROUP_ID_LENGTH = 128;
const PROJECT_FILES = {
    high: ['package.json', 'pyproject.toml', 'setup.py', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json', 'Makefile', 'CMakeLists.txt'],
    medium: ['.git', 'src', 'lib', 'app', 'README.md'],
};
const LANGUAGE_EXTENSIONS = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript',
    '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin',
    '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#', '.cpp': 'C++', '.c': 'C', '.swift': 'Swift',
};
const FRAMEWORK_INDICATORS = {
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
const ARCHITECTURE_INDICATORS = {
    'clean-architecture': ['domain', 'application', 'infrastructure'],
    'mvc': ['models', 'views', 'controllers'],
    'hexagonal': ['adapters', 'ports', 'domain'],
    'monorepo': ['packages', 'apps', 'libs'],
};
const TEST_DIRS = ['tests', 'test', '__tests__', 'spec', 'specs'];
const ENTRY_PATTERNS = ['index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js', 'cli.ts', 'cli.js', 'main.py', 'app.py'];
/**
 * Creates an init review service instance.
 */
function createInitReviewService() {
    function scanDirectory(dir, maxDepth = 4, currentDepth = 0) {
        const files = [];
        const dirs = [];
        if (currentDepth >= maxDepth)
            return { files, dirs };
        try {
            const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'target', '.next', '.lisa', '.claude'].includes(entry.name))
                    continue;
                const fullPath = path_1.default.join(dir, entry.name);
                const relativePath = path_1.default.relative(process.cwd(), fullPath);
                if (entry.isDirectory()) {
                    dirs.push(relativePath);
                    const sub = scanDirectory(fullPath, maxDepth, currentDepth + 1);
                    files.push(...sub.files);
                    dirs.push(...sub.dirs);
                }
                else if (entry.isFile()) {
                    files.push(relativePath);
                }
            }
        }
        catch { /* ignore */ }
        return { files, dirs };
    }
    function detectLanguages(files) {
        const langCounts = {};
        for (const file of files) {
            const ext = path_1.default.extname(file);
            const lang = LANGUAGE_EXTENSIONS[ext];
            if (lang)
                langCounts[lang] = (langCounts[lang] || 0) + 1;
        }
        return Object.entries(langCounts).sort((a, b) => b[1] - a[1]).map(([lang]) => lang);
    }
    function detectFrameworks(projectRoot, deps) {
        const frameworks = [];
        for (const [framework, indicators] of Object.entries(FRAMEWORK_INDICATORS)) {
            for (const file of indicators.files) {
                if (fs_1.default.existsSync(path_1.default.join(projectRoot, file))) {
                    frameworks.push(framework);
                    break;
                }
            }
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
    function getDependencies(projectRoot) {
        const production = [];
        const dev = [];
        const pkgPath = path_1.default.join(projectRoot, 'package.json');
        if (fs_1.default.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs_1.default.readFileSync(pkgPath, 'utf8'));
                if (pkg.dependencies)
                    production.push(...Object.keys(pkg.dependencies));
                if (pkg.devDependencies)
                    dev.push(...Object.keys(pkg.devDependencies));
            }
            catch { /* ignore */ }
        }
        return { production, dev, all: [...production, ...dev] };
    }
    function getMarkerPath(projectRoot) {
        return path_1.default.join(projectRoot, '.lisa', '.init-review-done');
    }
    return {
        normalizePathToGroupId(absolutePath) {
            let normalized = absolutePath
                .toLowerCase()
                .replace(/^[a-z]:/i, (m) => m.charAt(0))
                .replace(/^\//, '')
                .replace(/\\/g, '-')
                .replace(/\//g, '-')
                .replace(/\./g, '_')
                .replace(/^-+/, '')
                .replace(/-+/g, '-');
            if (normalized.length > MAX_GROUP_ID_LENGTH)
                normalized = normalized.slice(-MAX_GROUP_ID_LENGTH);
            return normalized;
        },
        getCurrentGroupId(cwd = process.cwd()) {
            return this.normalizePathToGroupId(cwd);
        },
        isCodebase(projectRoot) {
            for (const file of PROJECT_FILES.high) {
                if (fs_1.default.existsSync(path_1.default.join(projectRoot, file))) {
                    return { isCodebase: true, confidence: 'high', reason: `Found ${file}` };
                }
            }
            let mediumCount = 0;
            for (const file of PROJECT_FILES.medium) {
                if (fs_1.default.existsSync(path_1.default.join(projectRoot, file)))
                    mediumCount++;
            }
            if (mediumCount >= 2) {
                return { isCodebase: true, confidence: 'medium', reason: `Found ${mediumCount} indicators` };
            }
            return { isCodebase: false, confidence: 'low', reason: 'No codebase indicators found' };
        },
        runAnalysis(projectRoot) {
            const { files, dirs } = scanDirectory(projectRoot);
            const deps = getDependencies(projectRoot);
            const languages = detectLanguages(files);
            const frameworks = detectFrameworks(projectRoot, deps.all);
            const testDirs = dirs.filter(d => TEST_DIRS.includes(path_1.default.basename(d))).slice(0, 5);
            const pkgPath = path_1.default.join(projectRoot, 'package.json');
            let projectName = path_1.default.basename(projectRoot);
            if (fs_1.default.existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(fs_1.default.readFileSync(pkgPath, 'utf8'));
                    if (pkg.name)
                        projectName = pkg.name.replace(/^@[^/]+\//, '');
                }
                catch { /* ignore */ }
            }
            const mainDirs = ['src', 'lib', 'app', 'domain', 'application', 'infrastructure', 'services'];
            const mainModules = dirs.filter(d => mainDirs.includes(path_1.default.basename(d))).slice(0, 10);
            const buildTools = [];
            if (fs_1.default.existsSync(path_1.default.join(projectRoot, 'package.json')))
                buildTools.push('npm');
            if (fs_1.default.existsSync(path_1.default.join(projectRoot, 'tsconfig.json')))
                buildTools.push('tsc');
            const dirNames = dirs.map(d => path_1.default.basename(d).toLowerCase());
            let architecture = null;
            for (const [arch, indicators] of Object.entries(ARCHITECTURE_INDICATORS)) {
                if (indicators.filter(ind => dirNames.includes(ind)).length >= 2) {
                    architecture = arch;
                    break;
                }
            }
            return {
                version: '1.0',
                timestamp: new Date().toISOString(),
                project: { name: projectName, path: projectRoot, groupId: this.getCurrentGroupId(projectRoot) },
                codebase: { language: languages[0] || 'Unknown', languages, framework: frameworks[0] || null, frameworks, buildTools },
                structure: { entryPoints: [], mainModules, testDirs, configFiles: [] },
                dependencies: { count: deps.all.length, production: deps.production.slice(0, 10), dev: deps.dev.slice(0, 5), noteworthy: [] },
                patterns: { architecture, testing: deps.all.includes('jest') ? 'jest' : null, formatting: deps.all.includes('prettier') ? 'prettier' : null, ci: fs_1.default.existsSync(path_1.default.join(projectRoot, '.github', 'workflows')) ? 'github-actions' : null },
                metrics: { fileCount: files.length, dirCount: dirs.length, hasTests: testDirs.length > 0, hasDocumentation: fs_1.default.existsSync(path_1.default.join(projectRoot, 'README.md')) },
            };
        },
        generateSummary(result) {
            const parts = [];
            const framework = result.codebase.framework ? ` with ${result.codebase.framework}` : '';
            parts.push(`${result.codebase.language} project${framework}`);
            if (result.patterns.architecture)
                parts.push(`using ${result.patterns.architecture} pattern`);
            if (result.codebase.buildTools.length > 0)
                parts.push(`Build: ${result.codebase.buildTools.join(', ')}`);
            if (result.structure.mainModules.length > 0)
                parts.push(`Modules: ${result.structure.mainModules.slice(0, 4).join(', ')}`);
            if (result.patterns.testing)
                parts.push(`Testing: ${result.patterns.testing}`);
            parts.push(`${result.metrics.fileCount} files, ${result.metrics.dirCount} directories`);
            return parts.join('. ') + '.';
        },
        readMarker(projectRoot) {
            const markerPath = getMarkerPath(projectRoot);
            if (!fs_1.default.existsSync(markerPath))
                return { done: false, enriched: false, timestamp: null };
            try {
                const content = JSON.parse(fs_1.default.readFileSync(markerPath, 'utf8'));
                return { done: true, enriched: content.enriched || false, timestamp: content.timestamp || null };
            }
            catch {
                return { done: true, enriched: false, timestamp: null };
            }
        },
        writeMarker(projectRoot, enriched = false) {
            const markerPath = getMarkerPath(projectRoot);
            const content = { version: '1.0', timestamp: new Date().toISOString(), groupId: this.getCurrentGroupId(projectRoot), enriched };
            fs_1.default.mkdirSync(path_1.default.dirname(markerPath), { recursive: true });
            fs_1.default.writeFileSync(markerPath, JSON.stringify(content, null, 2));
        },
        deleteMarker(projectRoot) {
            const markerPath = getMarkerPath(projectRoot);
            if (fs_1.default.existsSync(markerPath))
                fs_1.default.unlinkSync(markerPath);
        },
        async storeToMemory(summary, projectRoot) {
            const memoryScript = path_1.default.join(__dirname, '..', '..', 'memory', 'scripts', 'memory.js');
            if (!fs_1.default.existsSync(memoryScript))
                throw new Error('Memory script not found');
            return new Promise((resolve, reject) => {
                const child = (0, child_process_1.spawn)('node', [memoryScript, 'add', summary, '--type', 'init-review', '--tag', 'scope:codebase', '--cache'], {
                    cwd: projectRoot,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
                let stderr = '';
                child.stderr.on('data', (data) => { stderr += data.toString(); });
                child.on('close', (code) => {
                    if (code === 0)
                        resolve();
                    else
                        reject(new Error(`Memory storage failed: ${stderr}`));
                });
            });
        },
        async loadFromMemory(projectRoot) {
            const memoryScript = path_1.default.join(__dirname, '..', '..', 'memory', 'scripts', 'memory.js');
            if (!fs_1.default.existsSync(memoryScript))
                return null;
            return new Promise((resolve) => {
                const child = (0, child_process_1.spawn)('node', [memoryScript, 'load', '--query', 'init-review', '--limit', '1', '--cache'], {
                    cwd: projectRoot,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
                let stdout = '';
                child.stdout.on('data', (data) => { stdout += data.toString(); });
                child.on('close', (code) => {
                    if (code === 0) {
                        try {
                            const result = JSON.parse(stdout);
                            const facts = result.facts || [];
                            resolve(facts.length > 0 ? (facts[0].fact || facts[0].name || null) : null);
                        }
                        catch {
                            resolve(null);
                        }
                    }
                    else {
                        resolve(null);
                    }
                });
            });
        },
    };
}
//# sourceMappingURL=InitReviewService.js.map