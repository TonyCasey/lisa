import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import {
  initCommand,
  doctorCommand,
  upCommand,
  downCommand,
  cleanupPreviousInstall,
  DEFAULT_ENDPOINT,
  DEFAULT_GROUP,
} from '../../../src/lib/cli';
import { IServices } from '../../../src/lib/services';

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

function makeServices(): IServices & {
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
  await initCommand({ cwd, endpoint: DEFAULT_ENDPOINT, group: DEFAULT_GROUP, force: true, mode: 'local', verbose: false }, services);

  // Skills are now copied via fs.copy (not templateCopier)
  // Hooks are now invoked via CLI commands (no bundled JS files)
  // Expect: .env.template (1) + rules (6) + docker (1) = 8 copies
  assert.ok(services.templateCopier.calls.length >= 8, `Expected at least 8 template copies, got ${services.templateCopier.calls.length}`);

  // Verify rules are copied with replacements
  const rulesCopy = services.templateCopier.calls.find((c) => c.dest.includes('rules') && c.dest.includes('clean-architecture'));
  assert.ok(rulesCopy, 'rules should be copied');
  assert.equal(rulesCopy?.replacements.GRAPHITI_ENDPOINT, DEFAULT_ENDPOINT);
  assert.equal(rulesCopy?.replacements.GRAPHITI_GROUP, DEFAULT_GROUP);
});

test('initCommand skips docker assets when includeDocker is false', async () => {
  const services = makeServices();
  const cwd = '/tmp/project';
  await initCommand({ cwd, endpoint: DEFAULT_ENDPOINT, group: DEFAULT_GROUP, force: true, includeDocker: false, mode: 'local', verbose: false }, services);

  // Docker assets should not be included
  assert.ok(!services.templateCopier.calls.find((c) => c.dest.endsWith('docker-compose.graphiti.yml')));
});

test('initCommand skip mode skips docker and copies docs', async () => {
  const services = makeServices();
  const cwd = '/tmp/project';
  await initCommand({ cwd, endpoint: DEFAULT_ENDPOINT, group: DEFAULT_GROUP, force: true, mode: 'skip', verbose: false }, services);

  // Docker assets should not be included for skip mode
  assert.ok(!services.templateCopier.calls.find((c) => c.dest.endsWith('docker-compose.graphiti.yml')));

  // Skip mode should still copy rule templates (skills are now copied via fs.copy)
  const rulesCopy = services.templateCopier.calls.find((c) => c.dest.includes('rules'));
  assert.ok(rulesCopy, 'Rules should be copied even in skip mode');
});

test('doctorCommand checks docker and MCP via services', async () => {
  const services = makeServices();
  await doctorCommand({ cwd: process.cwd(), compose: 'docker-compose.graphiti.yml', endpoint: 'http://mcp' }, services);
  assert.equal(services.docker.versionCalls, 1);
  assert.equal(services.docker.composeVersionCalls, 1);
  assert.deepEqual(services.mcp.pings, ['http://mcp']);
});

test('up/down commands delegate to docker compose', async () => {
  const services = makeServices();
  await upCommand({ composeFile: 'foo.yml' }, services);
  await downCommand({ composeFile: 'foo.yml' }, services);
  assert.deepEqual(services.docker.composeCalls, [
    { composeFile: 'foo.yml', args: ['up', '-d'], stdio: 'inherit' },
    { composeFile: 'foo.yml', args: ['down'], stdio: 'inherit' },
  ]);
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
