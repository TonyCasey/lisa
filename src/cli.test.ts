import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  initCommand,
  doctorCommand,
  upCommand,
  downCommand,
  DEFAULT_ENDPOINT,
  DEFAULT_GROUP,
} from './cli';
import { IServices } from './lib/services';

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
  await initCommand({ cwd, endpoint: DEFAULT_ENDPOINT, group: DEFAULT_GROUP, force: true, mode: 'local' }, services);

  // Expect skills (2) + rules (6) + claude (3) + docker (2) = 13 copies
  assert.ok(services.templateCopier.calls.length >= 10, `Expected at least 10 template copies, got ${services.templateCopier.calls.length}`);
  const memoryCopy = services.templateCopier.calls.find((c) => c.dest.endsWith(path.join('.agents', 'skills', 'memory', 'SKILL.md')));
  assert.ok(memoryCopy, 'memory SKILL should be copied');
  assert.equal(memoryCopy?.replacements.GRAPHITI_ENDPOINT, DEFAULT_ENDPOINT);
  assert.equal(memoryCopy?.replacements.GRAPHITI_GROUP, DEFAULT_GROUP);
});

test('initCommand skips docker assets when includeDocker is false', async () => {
  const services = makeServices();
  const cwd = '/tmp/project';
  await initCommand({ cwd, endpoint: DEFAULT_ENDPOINT, group: DEFAULT_GROUP, force: true, includeDocker: false, mode: 'local' }, services);

  // Docker assets should not be included
  assert.ok(!services.templateCopier.calls.find((c) => c.dest.endsWith('docker-compose.graphiti.yml')));
});

test('initCommand skip mode skips docker and copies docs', async () => {
  const services = makeServices();
  const cwd = '/tmp/project';
  await initCommand({ cwd, endpoint: DEFAULT_ENDPOINT, group: DEFAULT_GROUP, force: true, mode: 'skip' }, services);

  // Docker assets should not be included for skip mode
  assert.ok(!services.templateCopier.calls.find((c) => c.dest.endsWith('docker-compose.graphiti.yml')));

  // Storage setup docs should be copied
  const docsCopy = services.templateCopier.calls.find((c) => c.dest.endsWith('STORAGE_SETUP.md'));
  assert.ok(docsCopy, 'STORAGE_SETUP.md should be copied');
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
