import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  createCliServices,
  type ICliServices,
} from '../../../../../src/lib/commands/cli-services';

describe('cli-services', () => {
  describe('createCliServices', () => {
    it('should return object with templateCopier, docker, and mcp services', () => {
      const services = createCliServices('/some/template/root');

      assert.ok(services.templateCopier, 'should have templateCopier');
      assert.ok(services.docker, 'should have docker');
      assert.ok(services.mcp, 'should have mcp');
    });

    it('should return templateCopier with a copy method', () => {
      const services = createCliServices('/some/template/root');

      assert.strictEqual(typeof services.templateCopier.copy, 'function');
    });

    it('should return docker with version, composeVersion, and compose methods', () => {
      const services = createCliServices('/some/template/root');

      assert.strictEqual(typeof services.docker.version, 'function');
      assert.strictEqual(typeof services.docker.composeVersion, 'function');
      assert.strictEqual(typeof services.docker.compose, 'function');
    });

    it('should return mcp with a ping method', () => {
      const services = createCliServices('/some/template/root');

      assert.strictEqual(typeof services.mcp.ping, 'function');
    });
  });

  describe('TemplateCopier.copy', () => {
    let tempDir: string;
    let templateRoot: string;
    let destDir: string;
    let services: ICliServices;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisa-cli-services-test-'));
      templateRoot = path.join(tempDir, 'templates');
      destDir = path.join(tempDir, 'dest');
      fs.mkdirSync(templateRoot, { recursive: true });
      fs.mkdirSync(destDir, { recursive: true });
      services = createCliServices(templateRoot);
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should copy template with replacements applied', async () => {
      // Arrange
      const templateRel = 'config.txt';
      fs.writeFileSync(
        path.join(templateRoot, templateRel),
        'Hello {{name}}, welcome to {{project}}!',
        'utf8',
      );
      const destAbs = path.join(destDir, 'config.txt');

      // Act
      const result = await services.templateCopier.copy(
        templateRel,
        destAbs,
        { name: 'Alice', project: 'Lisa' },
      );

      // Assert
      assert.strictEqual(result.skipped, false);
      const content = fs.readFileSync(destAbs, 'utf8');
      assert.strictEqual(content, 'Hello Alice, welcome to Lisa!');
    });

    it('should skip when destination exists and force is false', async () => {
      // Arrange
      const templateRel = 'config.txt';
      fs.writeFileSync(
        path.join(templateRoot, templateRel),
        'new content',
        'utf8',
      );
      const destAbs = path.join(destDir, 'config.txt');
      fs.writeFileSync(destAbs, 'existing content', 'utf8');

      // Act
      const result = await services.templateCopier.copy(
        templateRel,
        destAbs,
        {},
        false,
      );

      // Assert
      assert.strictEqual(result.skipped, true);
      const content = fs.readFileSync(destAbs, 'utf8');
      assert.strictEqual(content, 'existing content');
    });

    it('should skip when destination exists and force is not provided (default false)', async () => {
      // Arrange
      const templateRel = 'config.txt';
      fs.writeFileSync(
        path.join(templateRoot, templateRel),
        'new content',
        'utf8',
      );
      const destAbs = path.join(destDir, 'config.txt');
      fs.writeFileSync(destAbs, 'existing content', 'utf8');

      // Act
      const result = await services.templateCopier.copy(
        templateRel,
        destAbs,
        {},
      );

      // Assert
      assert.strictEqual(result.skipped, true);
      const content = fs.readFileSync(destAbs, 'utf8');
      assert.strictEqual(content, 'existing content');
    });

    it('should overwrite when force is true', async () => {
      // Arrange
      const templateRel = 'config.txt';
      fs.writeFileSync(
        path.join(templateRoot, templateRel),
        'overwritten: {{value}}',
        'utf8',
      );
      const destAbs = path.join(destDir, 'config.txt');
      fs.writeFileSync(destAbs, 'existing content', 'utf8');

      // Act
      const result = await services.templateCopier.copy(
        templateRel,
        destAbs,
        { value: 'forced' },
        true,
      );

      // Assert
      assert.strictEqual(result.skipped, false);
      const content = fs.readFileSync(destAbs, 'utf8');
      assert.strictEqual(content, 'overwritten: forced');
    });

    it('should throw when template source does not exist', async () => {
      // Arrange
      const templateRel = 'nonexistent.txt';
      const destAbs = path.join(destDir, 'output.txt');

      // Act & Assert
      await assert.rejects(
        () => services.templateCopier.copy(templateRel, destAbs, {}),
        (err: Error) => {
          assert.ok(err.message.includes('Missing template'));
          assert.ok(err.message.includes('nonexistent.txt'));
          return true;
        },
      );
    });

    it('should create parent directories as needed', async () => {
      // Arrange
      const templateRel = 'config.txt';
      fs.writeFileSync(
        path.join(templateRoot, templateRel),
        'content: {{val}}',
        'utf8',
      );
      const destAbs = path.join(destDir, 'nested', 'deep', 'dir', 'config.txt');

      // Act
      const result = await services.templateCopier.copy(
        templateRel,
        destAbs,
        { val: 'deep' },
      );

      // Assert
      assert.strictEqual(result.skipped, false);
      assert.ok(fs.existsSync(destAbs), 'destination file should exist');
      const content = fs.readFileSync(destAbs, 'utf8');
      assert.strictEqual(content, 'content: deep');
    });

    it('should replace multiple occurrences of the same placeholder', async () => {
      // Arrange
      const templateRel = 'multi.txt';
      fs.writeFileSync(
        path.join(templateRoot, templateRel),
        '{{name}} says hello. {{name}} says goodbye.',
        'utf8',
      );
      const destAbs = path.join(destDir, 'multi.txt');

      // Act
      const result = await services.templateCopier.copy(
        templateRel,
        destAbs,
        { name: 'Bob' },
      );

      // Assert
      assert.strictEqual(result.skipped, false);
      const content = fs.readFileSync(destAbs, 'utf8');
      assert.strictEqual(content, 'Bob says hello. Bob says goodbye.');
    });

    it('should replace multiple different placeholders', async () => {
      // Arrange
      const templateRel = 'multi-keys.txt';
      fs.writeFileSync(
        path.join(templateRoot, templateRel),
        '{{greeting}} {{name}}, you have {{count}} messages.',
        'utf8',
      );
      const destAbs = path.join(destDir, 'multi-keys.txt');

      // Act
      const result = await services.templateCopier.copy(
        templateRel,
        destAbs,
        { greeting: 'Hi', name: 'Charlie', count: '5' },
      );

      // Assert
      assert.strictEqual(result.skipped, false);
      const content = fs.readFileSync(destAbs, 'utf8');
      assert.strictEqual(content, 'Hi Charlie, you have 5 messages.');
    });

    it('should leave content unchanged when replacements is empty', async () => {
      // Arrange
      const templateRel = 'no-replace.txt';
      const templateContent = 'No {{placeholders}} here... well, one.';
      fs.writeFileSync(
        path.join(templateRoot, templateRel),
        templateContent,
        'utf8',
      );
      const destAbs = path.join(destDir, 'no-replace.txt');

      // Act
      const result = await services.templateCopier.copy(
        templateRel,
        destAbs,
        {},
      );

      // Assert
      assert.strictEqual(result.skipped, false);
      const content = fs.readFileSync(destAbs, 'utf8');
      assert.strictEqual(content, templateContent);
    });

    it('should handle template in a subdirectory', async () => {
      // Arrange
      const subDir = path.join(templateRoot, 'sub', 'dir');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(
        path.join(subDir, 'nested.txt'),
        'nested: {{key}}',
        'utf8',
      );
      const destAbs = path.join(destDir, 'nested.txt');

      // Act
      const result = await services.templateCopier.copy(
        path.join('sub', 'dir', 'nested.txt'),
        destAbs,
        { key: 'value' },
      );

      // Assert
      assert.strictEqual(result.skipped, false);
      const content = fs.readFileSync(destAbs, 'utf8');
      assert.strictEqual(content, 'nested: value');
    });
  });
});
