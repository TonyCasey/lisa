import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { createDefaultServices } from './services';

let tempDir: string;
let templateDir: string;
let destDir: string;

beforeEach(async () => {
  // Create temp directories for each test
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lisa-test-'));
  templateDir = path.join(tempDir, 'templates');
  destDir = path.join(tempDir, 'dest');
  await fs.ensureDir(templateDir);
  await fs.ensureDir(destDir);
});

afterEach(async () => {
  // Clean up temp directories
  await fs.remove(tempDir);
});

test('DefaultTemplateCopier copies file with replacements', async () => {
  // Arrange
  const templateContent = 'Hello {{NAME}}, welcome to {{PROJECT}}!';
  const templateFile = 'greeting.txt';
  await fs.writeFile(path.join(templateDir, templateFile), templateContent);

  const services = createDefaultServices(templateDir);
  const destPath = path.join(destDir, 'output.txt');
  const replacements = { NAME: 'Alice', PROJECT: 'Lisa' };

  // Act
  const result = await services.templateCopier.copy(templateFile, destPath, replacements);

  // Assert
  assert.equal(result.skipped, false);
  const outputContent = await fs.readFile(destPath, 'utf8');
  assert.equal(outputContent, 'Hello Alice, welcome to Lisa!');
});

test('DefaultTemplateCopier skips existing file when force is false', async () => {
  // Arrange
  const templateContent = 'New content';
  const templateFile = 'file.txt';
  await fs.writeFile(path.join(templateDir, templateFile), templateContent);

  const destPath = path.join(destDir, 'existing.txt');
  const existingContent = 'Existing content';
  await fs.writeFile(destPath, existingContent);

  const services = createDefaultServices(templateDir);

  // Act
  const result = await services.templateCopier.copy(templateFile, destPath, {}, false);

  // Assert
  assert.equal(result.skipped, true);
  const outputContent = await fs.readFile(destPath, 'utf8');
  assert.equal(outputContent, existingContent); // Should not be overwritten
});

test('DefaultTemplateCopier overwrites existing file when force is true', async () => {
  // Arrange
  const templateContent = 'New content from {{SOURCE}}';
  const templateFile = 'file.txt';
  await fs.writeFile(path.join(templateDir, templateFile), templateContent);

  const destPath = path.join(destDir, 'existing.txt');
  await fs.writeFile(destPath, 'Old content');

  const services = createDefaultServices(templateDir);

  // Act
  const result = await services.templateCopier.copy(templateFile, destPath, { SOURCE: 'template' }, true);

  // Assert
  assert.equal(result.skipped, false);
  const outputContent = await fs.readFile(destPath, 'utf8');
  assert.equal(outputContent, 'New content from template');
});

test('DefaultTemplateCopier throws error for missing template', async () => {
  // Arrange
  const services = createDefaultServices(templateDir);
  const destPath = path.join(destDir, 'output.txt');

  // Act & Assert
  await assert.rejects(
    async () => services.templateCopier.copy('nonexistent.txt', destPath, {}),
    (error: Error) => {
      assert.match(error.message, /Missing template/);
      return true;
    }
  );
});

test('DefaultTemplateCopier creates parent directories if they do not exist', async () => {
  // Arrange
  const templateContent = 'Content';
  const templateFile = 'file.txt';
  await fs.writeFile(path.join(templateDir, templateFile), templateContent);

  const services = createDefaultServices(templateDir);
  const destPath = path.join(destDir, 'nested', 'deep', 'output.txt');

  // Act
  const result = await services.templateCopier.copy(templateFile, destPath, {});

  // Assert
  assert.equal(result.skipped, false);
  assert.ok(await fs.pathExists(destPath));
  const outputContent = await fs.readFile(destPath, 'utf8');
  assert.equal(outputContent, 'Content');
});

test('DefaultTemplateCopier handles multiple occurrences of same placeholder', async () => {
  // Arrange
  const templateContent = '{{VAR}} and {{VAR}} and {{VAR}}';
  const templateFile = 'multi.txt';
  await fs.writeFile(path.join(templateDir, templateFile), templateContent);

  const services = createDefaultServices(templateDir);
  const destPath = path.join(destDir, 'output.txt');

  // Act
  await services.templateCopier.copy(templateFile, destPath, { VAR: 'X' });

  // Assert
  const outputContent = await fs.readFile(destPath, 'utf8');
  assert.equal(outputContent, 'X and X and X');
});

test('DefaultTemplateCopier preserves content with no placeholders', async () => {
  // Arrange
  const templateContent = 'Plain text with no placeholders';
  const templateFile = 'plain.txt';
  await fs.writeFile(path.join(templateDir, templateFile), templateContent);

  const services = createDefaultServices(templateDir);
  const destPath = path.join(destDir, 'output.txt');

  // Act
  await services.templateCopier.copy(templateFile, destPath, { UNUSED: 'value' });

  // Assert
  const outputContent = await fs.readFile(destPath, 'utf8');
  assert.equal(outputContent, templateContent);
});
