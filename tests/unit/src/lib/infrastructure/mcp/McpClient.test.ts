import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { McpClient } from '../../../../../../src/lib/infrastructure/mcp/McpClient';

describe('McpClient', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('session management', () => {
    it('should initialize session on first call', async () => {
      const sessionId = 'test-session-123';
      let callCount = 0;

      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        callCount++;
        const body = JSON.parse(options.body as string);

        if (body.method === 'initialize') {
          return new Response(JSON.stringify({ result: {} }), {
            status: 200,
            headers: { 'mcp-session-id': sessionId },
          });
        }

        // Subsequent calls
        return new Response(JSON.stringify({ result: { facts: [] } }), {
          status: 200,
          headers: { 'mcp-session-id': sessionId },
        });
      }) as unknown as typeof fetch;

      const client = new McpClient('http://localhost:8010/mcp/');
      const [result, returnedSid] = await client.call('search_memory_facts', { query: '*' });

      assert.strictEqual(callCount, 2); // Initialize + actual call
      assert.strictEqual(returnedSid, sessionId);
      assert.strictEqual(client.getSessionId(), sessionId);
    });

    it('should reuse session ID for subsequent calls', async () => {
      const sessionId = 'test-session-456';
      const sessionIds: (string | null | undefined)[] = [];

      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        const headers = options.headers as Record<string, string>;
        // Capture the session ID used in the request (may be undefined for init)
        sessionIds.push(headers['MCP-SESSION-ID']);

        const body = JSON.parse(options.body as string);
        if (body.method === 'initialize') {
          return new Response(JSON.stringify({ result: {} }), {
            status: 200,
            headers: { 'mcp-session-id': sessionId },
          });
        }

        return new Response(JSON.stringify({ result: { facts: [] } }), {
          status: 200,
          headers: { 'mcp-session-id': sessionId },
        });
      }) as unknown as typeof fetch;

      const client = new McpClient('http://localhost:8010/mcp/');

      // First call triggers initialize
      await client.call('search_memory_facts', { query: 'first' });

      // Second call should use cached session
      await client.call('search_memory_facts', { query: 'second' });

      // Third call should also use cached session
      await client.call('search_memory_facts', { query: 'third' });

      // First is initialize (no session header), then 3 calls with session
      assert.ok(sessionIds[0] === undefined || sessionIds[0] === null); // Initialize has no session
      assert.strictEqual(sessionIds[1], sessionId);
      assert.strictEqual(sessionIds[2], sessionId);
      assert.strictEqual(sessionIds[3], sessionId);
    });

    it('should update session ID when server returns new one', async () => {
      const initialSession = 'initial-session';
      const updatedSession = 'updated-session';
      let callCount = 0;

      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        callCount++;
        const body = JSON.parse(options.body as string);

        if (body.method === 'initialize') {
          return new Response(JSON.stringify({ result: {} }), {
            status: 200,
            headers: { 'mcp-session-id': initialSession },
          });
        }

        // Return different session on second call
        const newSession = callCount === 2 ? initialSession : updatedSession;
        return new Response(JSON.stringify({ result: { facts: [] } }), {
          status: 200,
          headers: { 'mcp-session-id': newSession },
        });
      }) as unknown as typeof fetch;

      const client = new McpClient('http://localhost:8010/mcp/');

      await client.call('search_memory_facts', { query: 'first' });
      assert.strictEqual(client.getSessionId(), initialSession);

      await client.call('search_memory_facts', { query: 'second' });
      assert.strictEqual(client.getSessionId(), updatedSession);
    });

    it('should reinitialize on 401 and retry', async () => {
      const firstSession = 'expired-session';
      const newSession = 'new-session';
      let callCount = 0;
      const methods: string[] = [];

      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        callCount++;
        const body = JSON.parse(options.body as string);
        methods.push(body.method);

        if (body.method === 'initialize') {
          const session = callCount === 1 ? firstSession : newSession;
          return new Response(JSON.stringify({ result: {} }), {
            status: 200,
            headers: { 'mcp-session-id': session },
          });
        }

        // Return 401 on first non-init call, success on retry
        if (callCount === 2) {
          return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), {
            status: 401,
            headers: {},
          });
        }

        return new Response(JSON.stringify({ result: { facts: ['success'] } }), {
          status: 200,
          headers: { 'mcp-session-id': newSession },
        });
      }) as unknown as typeof fetch;

      const client = new McpClient('http://localhost:8010/mcp/');
      const [result] = await client.call('search_memory_facts', { query: '*' });

      // Should have: init -> call (401) -> reinit -> call (success)
      assert.strictEqual(callCount, 4);
      assert.deepStrictEqual(methods, ['initialize', 'tools/call', 'initialize', 'tools/call']);
      assert.strictEqual(client.getSessionId(), newSession);
    });

    it('should ignore passed sessionId parameter', async () => {
      const internalSession = 'internal-session';
      const passedSession = 'passed-session';
      let usedSession: string | null = null;

      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        const headers = options.headers as Record<string, string>;
        const body = JSON.parse(options.body as string);

        if (body.method === 'initialize') {
          return new Response(JSON.stringify({ result: {} }), {
            status: 200,
            headers: { 'mcp-session-id': internalSession },
          });
        }

        usedSession = headers['MCP-SESSION-ID'];
        return new Response(JSON.stringify({ result: { facts: [] } }), {
          status: 200,
          headers: { 'mcp-session-id': internalSession },
        });
      }) as unknown as typeof fetch;

      const client = new McpClient('http://localhost:8010/mcp/');

      // Pass a different session ID - it should be ignored
      await client.call('search_memory_facts', { query: '*' }, passedSession);

      // Should use internal session, not passed one
      assert.strictEqual(usedSession, internalSession);
      assert.notStrictEqual(usedSession, passedSession);
    });

    it('should prevent concurrent initialization', async () => {
      const sessionId = 'concurrent-session';
      let initCount = 0;

      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        const body = JSON.parse(options.body as string);

        if (body.method === 'initialize') {
          initCount++;
          // Add delay to simulate slow init
          await new Promise((resolve) => setTimeout(resolve, 50));
          return new Response(JSON.stringify({ result: {} }), {
            status: 200,
            headers: { 'mcp-session-id': sessionId },
          });
        }

        return new Response(JSON.stringify({ result: { facts: [] } }), {
          status: 200,
          headers: { 'mcp-session-id': sessionId },
        });
      }) as unknown as typeof fetch;

      const client = new McpClient('http://localhost:8010/mcp/');

      // Start multiple calls concurrently
      const results = await Promise.all([
        client.call('search_memory_facts', { query: '1' }),
        client.call('search_memory_facts', { query: '2' }),
        client.call('search_memory_facts', { query: '3' }),
      ]);

      // Should only initialize once despite concurrent calls
      assert.strictEqual(initCount, 1);
      assert.strictEqual(results.length, 3);
    });
  });

  describe('call method', () => {
    it('should wrap tool calls in tools/call format', async () => {
      let capturedPayload: Record<string, unknown> | null = null;

      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        const body = JSON.parse(options.body as string);

        if (body.method === 'initialize') {
          return new Response(JSON.stringify({ result: {} }), {
            status: 200,
            headers: { 'mcp-session-id': 'test' },
          });
        }

        capturedPayload = body;
        return new Response(JSON.stringify({ result: { facts: [] } }), {
          status: 200,
          headers: { 'mcp-session-id': 'test' },
        });
      }) as unknown as typeof fetch;

      const client = new McpClient('http://localhost:8010/mcp/');
      await client.call('search_memory_facts', { query: '*', max_facts: 10 });

      assert.deepStrictEqual(capturedPayload, {
        jsonrpc: '2.0',
        id: '1',
        method: 'tools/call',
        params: {
          name: 'search_memory_facts',
          arguments: { query: '*', max_facts: 10 },
        },
      });
    });

    it('should not wrap ping method', async () => {
      let capturedPayload: Record<string, unknown> | null = null;

      globalThis.fetch = mock.fn(async (url: string, options: RequestInit) => {
        const body = JSON.parse(options.body as string);

        if (body.method === 'initialize') {
          return new Response(JSON.stringify({ result: {} }), {
            status: 200,
            headers: { 'mcp-session-id': 'test' },
          });
        }

        capturedPayload = body;
        return new Response(JSON.stringify({ result: {} }), {
          status: 200,
          headers: { 'mcp-session-id': 'test' },
        });
      }) as unknown as typeof fetch;

      const client = new McpClient('http://localhost:8010/mcp/');
      await client.call('ping', {});

      assert.deepStrictEqual(capturedPayload, {
        jsonrpc: '2.0',
        id: '1',
        method: 'ping',
        params: {},
      });
    });
  });
});
