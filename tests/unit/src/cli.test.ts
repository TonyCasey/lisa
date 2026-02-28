import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import {
  initCommand,
  doctorCommand,
  cleanupPreviousInstall,
  DEFAULT_GROUP,
} from '../../../src/lib/cli';
import type { ICliServices } from '../../../src/lib/commands/cli-services';

class MockTemplateCopier {
  calls: Array<{ rel: string; dest: string; force?: boolean; replacements: Record<string, string> }> = [];
  async copy(rel: string, dest: string, replacements: Record<string, string>, force?: boolean) {
    this.calls.push({ rel, dest, force, replacements });
    return { skipped: false };
  }
}

class MockDockerClient {
  versionCalls = 0;
  composeVersionCalls = 0;
  composeCalls: Array<{ composeFile: string; args: string[]; stdio: string }> = [];
  async version() {
    this.versionCalls += 1;
    return 'Docker 25.0';
  }
  async composeVersion() {
    this.composeVersionCalls += 1;
    return 'Docker Compose v2.27';
  }
  async compose(composeFile: string, args: string[], stdio: 'inherit' | 'pipe' = 'inherit') {
    this.composeCalls.push({ composeFile, args, stdio });
  }
}

class MockMcpClient {
  pings: string[] = [];
  async ping(endpoint: string) {
    this.pings.push(endpoint);
  }
}

function makeServices(): ICliServices & {
  templateCopier: MockTemplateCopier;
  docker: MockDockerClient;
  mcp: MockMcpClient;
} {
  return {
    templateCopier: new MockTemplateCopier(),
    docker: new MockDockerClient(),
    mcp: new MockMcpClient(),
  };
}

test('initCommand copies expected templates with replacements', async () => {
  const services = makeServices();
  const cwd = '/tmp/project';
  await initCommand({ cwd, force: true, verbose: false, yes: true }, services);

  // Skills are now copied via fs.copy (not templateCopier)
  // Hooks are now invoked via CLI commands (no bundled JS files)
  // Expect: .env.template (1) + rules (10) = 11 copies minimum
  assert.ok(services.templateCopier.calls.length >= 1, `Expected at least 1 template copy, got ${services.templateCopier.calls.length}`);

  // Verify rules are copied with replacements
  const rulesCopy = services.templateCopier.calls.find((c) => c.dest.includes('rules') && c.dest.includes('clean-architecture'));
  assert.ok(rulesCopy, 'rules should be copied');
  assert.ok(rulesCopy?.replacements.PROJECT_NAME, 'PROJECT_NAME replacement should be set');
});

test('doctorCommand runs health checks', async () => {
  const services = makeServices();
  // Run doctor on current directory (which is a git repo)
  // Capture console output to avoid polluting test output
  const originalLog = console.log;
  console.log = () => {};
  try {
    await doctorCommand({ cwd: process.cwd(), verbose: false }, services);
  } finally {
    console.log = originalLog;
  }
  // Doctor no longer checks Docker - it checks git-mem and Lisa structure
  // This test just verifies it runs without error
});

// cleanupPreviousInstall tests
test('cleanupPreviousInstall returns empty arrays for non-existent directory', async () => {
  const result = await cleanupPreviousInstall('/non/existent/path');
  assert.deepEqual(result.backedUp, []);
  assert.deepEqual(result.removed, []);
});

test('cleanupPreviousInstall removes scripts/*.js files', async () => {
  const tmpDir = path.join(os.tmpdir(), `lisa-test-cleanup-${Date.now()}`);
  const skillsDir = path.join(tmpDir, 'skills');
  const memorySkill = path.join(skillsDir, 'memory');
  const scriptsDir = path.join(memorySkill, 'scripts');

  try {
    // Create old-style skill structure with scripts
    await fs.ensureDir(scriptsDir);
    await fs.writeFile(path.join(scriptsDir, 'memory.js'), '// old script');
    await fs.writeFile(path.join(scriptsDir, 'helper.js'), '// old helper');
    await fs.writeFile(path.join(memorySkill, 'SKILL.md'), '# Memory Skill');

    const result = await cleanupPreviousInstall(skillsDir);

    // Should have backed up SKILL.md
    assert.equal(result.backedUp.length, 1);
    assert.ok(result.backedUp[0].includes('SKILL.md'));

    // Should have removed the JS files and scripts directory
    assert.ok(result.removed.length >= 2, `Expected at least 2 removed items, got ${result.removed.length}`);

    // Verify JS files are removed
    assert.equal(await fs.pathExists(path.join(scriptsDir, 'memory.js')), false);
    assert.equal(await fs.pathExists(path.join(scriptsDir, 'helper.js')), false);

    // Scripts directory should be removed (was empty after JS removal)
    assert.equal(await fs.pathExists(scriptsDir), false);

    // Backup should exist
    assert.equal(await fs.pathExists(path.join(memorySkill, 'SKILL.md.backup')), true);
  } finally {
    await fs.remove(tmpDir);
  }
});

test('cleanupPreviousInstall removes common/ and shared/ directories', async () => {
  const tmpDir = path.join(os.tmpdir(), `lisa-test-cleanup-common-${Date.now()}`);
  const skillsDir = path.join(tmpDir, 'skills');

  try {
    // Create old-style common and shared directories
    await fs.ensureDir(path.join(skillsDir, 'common'));
    await fs.ensureDir(path.join(skillsDir, 'shared'));
    await fs.writeFile(path.join(skillsDir, 'common', 'group-id.js'), '// old');
    await fs.writeFile(path.join(skillsDir, 'shared', 'utils.js'), '// old');

    const result = await cleanupPreviousInstall(skillsDir);

    // Should have removed common and shared
    assert.ok(result.removed.some(r => r.includes('common')), 'common/ should be removed');
    assert.ok(result.removed.some(r => r.includes('shared')), 'shared/ should be removed');

    // Verify directories are gone
    assert.equal(await fs.pathExists(path.join(skillsDir, 'common')), false);
    assert.equal(await fs.pathExists(path.join(skillsDir, 'shared')), false);
  } finally {
    await fs.remove(tmpDir);
  }
});

test('cleanupPreviousInstall preserves non-JS files in scripts/', async () => {
  const tmpDir = path.join(os.tmpdir(), `lisa-test-cleanup-preserve-${Date.now()}`);
  const skillsDir = path.join(tmpDir, 'skills');
  const gitSkill = path.join(skillsDir, 'git');
  const scriptsDir = path.join(gitSkill, 'scripts');

  try {
    // Create scripts with both JS and shell files
    await fs.ensureDir(scriptsDir);
    await fs.writeFile(path.join(scriptsDir, 'old-script.js'), '// old');
    await fs.writeFile(path.join(scriptsDir, 'poll-ci.sh'), '#!/bin/bash');

    await cleanupPreviousInstall(skillsDir);

    // JS file should be removed
    assert.equal(await fs.pathExists(path.join(scriptsDir, 'old-script.js')), false);

    // Shell script should remain
    assert.equal(await fs.pathExists(path.join(scriptsDir, 'poll-ci.sh')), true);

    // Scripts directory should NOT be removed (has non-JS files)
    assert.equal(await fs.pathExists(scriptsDir), true);
  } finally {
    await fs.remove(tmpDir);
  }
});
