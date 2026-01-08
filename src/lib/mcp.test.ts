import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { pingMcp } from './mcp';

// Store original fetch
const originalFetch = globalThis.fetch;

// Mock response factory
function createMockResponse(options: {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
}): Response {
  const { ok = true, status = 200, headers = {} } = options;
  return {
    ok,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] || null,
    },
  } as unknown as Response;
}

beforeEach(() => {
  // Reset fetch mock before each test
  globalThis.fetch = mock.fn();
});

afterEach(() => {
  // Restore original fetch after each test
  globalThis.fetch = originalFetch;
});

test('pingMcp should succeed when server returns valid response with session id', async () => {
  // Arrange
  const endpoint = 'http://localhost:8010/mcp/';
  const mockFetch = mock.fn(async () =>
    createMockResponse({
      ok: true,
      status: 200,
      headers: { 'mcp-session-id': 'test-session-123' },
    })
  );
  globalThis.fetch = mockFetch;

  // Act & Assert - should not throw
  await pingMcp(endpoint);

  // Verify fetch was called correctly
  assert.equal(mockFetch.mock.calls.length, 1);
  const [callUrl, callOptions] = mockFetch.mock.calls[0].arguments;
  assert.equal(callUrl, endpoint);
  assert.equal(callOptions.method, 'POST');
  assert.equal(callOptions.headers['Content-Type'], 'application/json');

  // Verify request body contains required MCP fields
  const body = JSON.parse(callOptions.body);
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.method, 'initialize');
  assert.ok(body.params.protocolVersion);
  assert.ok(body.params.clientInfo.name);
});

test('pingMcp should throw error when HTTP response is not ok', async () => {
  // Arrange
  const endpoint = 'http://localhost:8010/mcp/';
  const mockFetch = mock.fn(async () =>
    createMockResponse({
      ok: false,
      status: 500,
      headers: {},
    })
  );
  globalThis.fetch = mockFetch;

  // Act & Assert
  await assert.rejects(
    async () => pingMcp(endpoint),
    (error: Error) => {
      assert.match(error.message, /HTTP 500/);
      return true;
    }
  );
});

test('pingMcp should throw error when mcp-session-id header is missing', async () => {
  // Arrange
  const endpoint = 'http://localhost:8010/mcp/';
  const mockFetch = mock.fn(async () =>
    createMockResponse({
      ok: true,
      status: 200,
      headers: {}, // No mcp-session-id
    })
  );
  globalThis.fetch = mockFetch;

  // Act & Assert
  await assert.rejects(
    async () => pingMcp(endpoint),
    (error: Error) => {
      assert.match(error.message, /mcp-session-id/i);
      return true;
    }
  );
});

test('pingMcp should throw error when fetch fails', async () => {
  // Arrange
  const endpoint = 'http://localhost:8010/mcp/';
  const mockFetch = mock.fn(async () => {
    throw new Error('Network error');
  });
  globalThis.fetch = mockFetch;

  // Act & Assert
  await assert.rejects(
    async () => pingMcp(endpoint),
    (error: Error) => {
      assert.match(error.message, /Network error/);
      return true;
    }
  );
});
