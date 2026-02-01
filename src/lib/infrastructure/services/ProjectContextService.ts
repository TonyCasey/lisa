/**
 * Project Context Service
 *
 * File-based storage of structured project context in .lisa/.project-context.json.
 * Auto-detects tech stack from project files during initialization.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  IProjectContext,
  IProjectContextUpdates,
  IProjectContextService,
} from '../../domain/interfaces/types/IProjectContext';

const CONTEXT_FILE = '.lisa/.project-context.json';

/**
 * Project context service implementation.
 * Stores context as a JSON file in the .lisa directory.
 */
export class ProjectContextService implements IProjectContextService {
  /**
   * Load project context from file.
   */
  async load(projectRoot: string): Promise<IProjectContext | null> {
    const filePath = path.join(projectRoot, CONTEXT_FILE);
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      return JSON.parse(content) as IProjectContext;
    } catch {
      return null;
    }
  }

  /**
   * Save project context to file.
   */
  async save(projectRoot: string, context: IProjectContext): Promise<void> {
    const filePath = path.join(projectRoot, CONTEXT_FILE);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      await fsp.mkdir(dir, { recursive: true });
    }
    await fsp.writeFile(filePath, JSON.stringify(context, null, 2) + '\n', 'utf-8');
  }

  /**
   * Initialize a new project context with auto-detection.
   */
  async init(projectRoot: string, projectName: string): Promise<IProjectContext> {
    const techStack = await this.detectTechStack(projectRoot);

    const context: IProjectContext = {
      projectName,
      techStack,
      keyDecisions: [],
      activeConstraints: [],
      conventions: [],
      updatedAt: new Date().toISOString(),
    };

    await this.save(projectRoot, context);
    return context;
  }

  /**
   * Update existing project context.
   * Merges arrays (appends unique items) and updates timestamp.
   */
  async update(projectRoot: string, updates: IProjectContextUpdates): Promise<IProjectContext> {
    const existing = await this.load(projectRoot);
    if (!existing) {
      throw new Error('No project context found. Run `lisa context init` first.');
    }

    const context: IProjectContext = {
      projectName: existing.projectName,
      techStack: mergeArrays(existing.techStack, updates.techStack),
      keyDecisions: mergeArrays(existing.keyDecisions, updates.keyDecisions),
      activeConstraints: mergeArrays(existing.activeConstraints, updates.activeConstraints),
      conventions: mergeArrays(existing.conventions, updates.conventions),
      updatedAt: new Date().toISOString(),
    };

    await this.save(projectRoot, context);
    return context;
  }

  /**
   * Auto-detect tech stack from project files.
   */
  private async detectTechStack(projectRoot: string): Promise<string[]> {
    const stack: string[] = [];

    // Check package.json
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf-8'));
        stack.push('Node.js');

        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps.typescript || fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) {
          stack.push('TypeScript');
        }
        if (allDeps.react) stack.push('React');
        if (allDeps.next) stack.push('Next.js');
        if (allDeps.express) stack.push('Express');
        if (allDeps.neo4j) stack.push('Neo4j');
        if (allDeps['neo4j-driver']) stack.push('Neo4j');
      } catch {
        // Ignore parse errors
      }
    }

    // Check tsconfig.json independently
    if (!stack.includes('TypeScript') && fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) {
      stack.push('TypeScript');
    }

    // Check Dockerfile
    if (fs.existsSync(path.join(projectRoot, 'Dockerfile'))) {
      stack.push('Docker');
    }

    // Check docker-compose files
    const composeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
    for (const file of composeFiles) {
      if (fs.existsSync(path.join(projectRoot, file))) {
        if (!stack.includes('Docker')) stack.push('Docker');
        stack.push('Docker Compose');
        break;
      }
    }

    // Check for Go
    if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
      stack.push('Go');
    }

    // Check for Python
    if (
      fs.existsSync(path.join(projectRoot, 'requirements.txt')) ||
      fs.existsSync(path.join(projectRoot, 'pyproject.toml')) ||
      fs.existsSync(path.join(projectRoot, 'setup.py'))
    ) {
      stack.push('Python');
    }

    // Check for Rust
    if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
      stack.push('Rust');
    }

    // Deduplicate
    return [...new Set(stack)];
  }
}

/**
 * Merge two readonly arrays, appending new unique items from the update.
 */
function mergeArrays(existing: readonly string[], update?: readonly string[]): readonly string[] {
  if (!update || update.length === 0) return existing;
  const set = new Set(existing);
  const merged = [...existing];
  for (const item of update) {
    if (!set.has(item)) {
      merged.push(item);
      set.add(item);
    }
  }
  return merged;
}
