/**
 * Tests for ProjectContextService.
 *
 * Tests file-based project context CRUD and auto-detection.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectContextService } from '../../../../../../src/lib/infrastructure/services/ProjectContextService';

describe('ProjectContextService', () => {
  let service: ProjectContextService;
  let tmpDir: string;

  beforeEach(async () => {
    service = new ProjectContextService();
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lisa-context-test-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  describe('load()', () => {
    it('should return null when no context file exists', async () => {
      const result = await service.load(tmpDir);
      assert.strictEqual(result, null);
    });

    it('should load valid JSON context', async () => {
      const lisaDir = path.join(tmpDir, '.lisa');
      await fsp.mkdir(lisaDir, { recursive: true });
      const context = {
        projectName: 'test-project',
        techStack: ['TypeScript', 'Node.js'],
        keyDecisions: ['Using Clean Architecture'],
        activeConstraints: [],
        conventions: ['Interfaces prefixed with I'],
        updatedAt: '2026-01-30T00:00:00.000Z',
      };
      await fsp.writeFile(
        path.join(lisaDir, '.project-context.json'),
        JSON.stringify(context),
        'utf-8'
      );

      const result = await service.load(tmpDir);
      assert.deepStrictEqual(result, context);
    });

    it('should return null for invalid JSON', async () => {
      const lisaDir = path.join(tmpDir, '.lisa');
      await fsp.mkdir(lisaDir, { recursive: true });
      await fsp.writeFile(
        path.join(lisaDir, '.project-context.json'),
        'not valid json',
        'utf-8'
      );

      const result = await service.load(tmpDir);
      assert.strictEqual(result, null);
    });
  });

  describe('save()', () => {
    it('should create .lisa directory and write JSON file', async () => {
      const context = {
        projectName: 'test-project',
        techStack: ['TypeScript'],
        keyDecisions: [],
        activeConstraints: [],
        conventions: [],
        updatedAt: '2026-01-30T00:00:00.000Z',
      };

      await service.save(tmpDir, context);

      const filePath = path.join(tmpDir, '.lisa', '.project-context.json');
      assert.ok(fs.existsSync(filePath));
      const content = JSON.parse(await fsp.readFile(filePath, 'utf-8'));
      assert.deepStrictEqual(content, context);
    });

    it('should overwrite existing file', async () => {
      const context1 = {
        projectName: 'test-project',
        techStack: ['TypeScript'],
        keyDecisions: [],
        activeConstraints: [],
        conventions: [],
        updatedAt: '2026-01-30T00:00:00.000Z',
      };
      const context2 = {
        projectName: 'test-project',
        techStack: ['TypeScript', 'Node.js'],
        keyDecisions: ['Decision A'],
        activeConstraints: [],
        conventions: [],
        updatedAt: '2026-01-31T00:00:00.000Z',
      };

      await service.save(tmpDir, context1);
      await service.save(tmpDir, context2);

      const result = await service.load(tmpDir);
      assert.deepStrictEqual(result, context2);
    });
  });

  describe('init()', () => {
    it('should create context with project name', async () => {
      const context = await service.init(tmpDir, 'my-project');
      assert.strictEqual(context.projectName, 'my-project');
      assert.ok(context.updatedAt);
      assert.deepStrictEqual(context.keyDecisions, []);
      assert.deepStrictEqual(context.activeConstraints, []);
      assert.deepStrictEqual(context.conventions, []);
    });

    it('should detect Node.js from package.json', async () => {
      await fsp.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test', dependencies: {} }),
        'utf-8'
      );

      const context = await service.init(tmpDir, 'test');
      assert.ok(context.techStack.includes('Node.js'));
    });

    it('should detect TypeScript from tsconfig.json', async () => {
      await fsp.writeFile(
        path.join(tmpDir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: {} }),
        'utf-8'
      );

      const context = await service.init(tmpDir, 'test');
      assert.ok(context.techStack.includes('TypeScript'));
    });

    it('should detect TypeScript from package.json devDependencies', async () => {
      await fsp.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          dependencies: {},
          devDependencies: { typescript: '^5.0.0' },
        }),
        'utf-8'
      );

      const context = await service.init(tmpDir, 'test');
      assert.ok(context.techStack.includes('TypeScript'));
      assert.ok(context.techStack.includes('Node.js'));
    });

    it('should detect Docker from Dockerfile', async () => {
      await fsp.writeFile(
        path.join(tmpDir, 'Dockerfile'),
        'FROM node:18',
        'utf-8'
      );

      const context = await service.init(tmpDir, 'test');
      assert.ok(context.techStack.includes('Docker'));
    });

    it('should detect Docker Compose from compose file', async () => {
      await fsp.writeFile(
        path.join(tmpDir, 'docker-compose.yml'),
        'version: "3"',
        'utf-8'
      );

      const context = await service.init(tmpDir, 'test');
      assert.ok(context.techStack.includes('Docker'));
      assert.ok(context.techStack.includes('Docker Compose'));
    });

    it('should detect Python from requirements.txt', async () => {
      await fsp.writeFile(
        path.join(tmpDir, 'requirements.txt'),
        'flask==2.0',
        'utf-8'
      );

      const context = await service.init(tmpDir, 'test');
      assert.ok(context.techStack.includes('Python'));
    });

    it('should detect Go from go.mod', async () => {
      await fsp.writeFile(
        path.join(tmpDir, 'go.mod'),
        'module example.com/test',
        'utf-8'
      );

      const context = await service.init(tmpDir, 'test');
      assert.ok(context.techStack.includes('Go'));
    });

    it('should detect Rust from Cargo.toml', async () => {
      await fsp.writeFile(
        path.join(tmpDir, 'Cargo.toml'),
        '[package]\nname = "test"',
        'utf-8'
      );

      const context = await service.init(tmpDir, 'test');
      assert.ok(context.techStack.includes('Rust'));
    });

    it('should not duplicate tech stack entries', async () => {
      // Both package.json with typescript dep AND tsconfig.json present
      await fsp.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          devDependencies: { typescript: '^5.0.0' },
        }),
        'utf-8'
      );
      await fsp.writeFile(
        path.join(tmpDir, 'tsconfig.json'),
        '{}',
        'utf-8'
      );

      const context = await service.init(tmpDir, 'test');
      const tsCount = context.techStack.filter(s => s === 'TypeScript').length;
      assert.strictEqual(tsCount, 1);
    });

    it('should save context file after init', async () => {
      await service.init(tmpDir, 'test');
      const loaded = await service.load(tmpDir);
      assert.ok(loaded);
      assert.strictEqual(loaded?.projectName, 'test');
    });

    it('should return empty tech stack for empty directory', async () => {
      const context = await service.init(tmpDir, 'test');
      assert.deepStrictEqual(context.techStack, []);
    });
  });

  describe('update()', () => {
    it('should append new items to existing arrays', async () => {
      await service.init(tmpDir, 'test');

      const updated = await service.update(tmpDir, {
        techStack: ['Redis'],
        keyDecisions: ['Use Redis for caching'],
      });

      assert.ok(updated.techStack.includes('Redis'));
      assert.ok(updated.keyDecisions.includes('Use Redis for caching'));
    });

    it('should not duplicate existing items', async () => {
      await fsp.mkdir(path.join(tmpDir, '.lisa'), { recursive: true });
      await fsp.writeFile(
        path.join(tmpDir, '.lisa', '.project-context.json'),
        JSON.stringify({
          projectName: 'test',
          techStack: ['TypeScript'],
          keyDecisions: [],
          activeConstraints: [],
          conventions: [],
          updatedAt: '2026-01-30T00:00:00.000Z',
        }),
        'utf-8'
      );

      const updated = await service.update(tmpDir, {
        techStack: ['TypeScript', 'Node.js'],
      });

      const tsCount = updated.techStack.filter(s => s === 'TypeScript').length;
      assert.strictEqual(tsCount, 1);
      assert.ok(updated.techStack.includes('Node.js'));
    });

    it('should update the timestamp', async () => {
      await fsp.mkdir(path.join(tmpDir, '.lisa'), { recursive: true });
      await fsp.writeFile(
        path.join(tmpDir, '.lisa', '.project-context.json'),
        JSON.stringify({
          projectName: 'test',
          techStack: [],
          keyDecisions: [],
          activeConstraints: [],
          conventions: [],
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
        'utf-8'
      );

      const updated = await service.update(tmpDir, { conventions: ['Use PascalCase'] });
      assert.notStrictEqual(updated.updatedAt, '2026-01-01T00:00:00.000Z');
    });

    it('should throw if no context file exists', async () => {
      await assert.rejects(
        () => service.update(tmpDir, { techStack: ['Redis'] }),
        { message: /No project context found/ }
      );
    });

    it('should preserve project name', async () => {
      await service.init(tmpDir, 'original-name');
      const updated = await service.update(tmpDir, { techStack: ['Redis'] });
      assert.strictEqual(updated.projectName, 'original-name');
    });

    it('should handle empty updates', async () => {
      await service.init(tmpDir, 'test');
      const updated = await service.update(tmpDir, {});
      assert.strictEqual(updated.projectName, 'test');
    });
  });
});
