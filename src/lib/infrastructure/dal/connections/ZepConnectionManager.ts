/**
 * Zep Cloud Connection Manager
 *
 * Manages connections to Zep Cloud REST API.
 * Used for cloud-based memory storage without Docker.
 */

import type {
  IZepConnectionManager,
  IZepConnectionConfig,
} from '../../../domain/interfaces/dal';

const ZEP_BASE_URL = 'https://api.getzep.com/api/v2';

/**
 * Zep Cloud Connection Manager implementation.
 * Uses Zep's native REST API.
 */
export class ZepConnectionManager implements IZepConnectionManager {
  private connected = false;

  constructor(private readonly config: IZepConnectionConfig) {}

  /**
   * Verify Zep Cloud API connectivity.
   */
  async connect(): Promise<void> {
    // Verify API key by making a test request
    try {
      await this.fetch('/users', { method: 'GET' });
      this.connected = true;
    } catch (error) {
      // 404 is ok - means the API is reachable but no users exist
      if (error instanceof Error && error.message.includes('404')) {
        this.connected = true;
        return;
      }
      throw error;
    }
  }

  /**
   * Check if the Zep Cloud API is reachable.
   */
  async isConnected(): Promise<boolean> {
    if (!this.connected) return false;
    try {
      await this.fetch('/users', { method: 'GET' });
      return true;
    } catch {
      // 404 is ok - API is reachable
      return true;
    }
  }

  /**
   * Close the connection (no-op for REST API).
   */
  async disconnect(): Promise<void> {
    this.connected = false;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): IZepConnectionConfig {
    return this.config;
  }

  /**
   * Execute a generic query (delegates to fetch).
   */
  async execute<T>(query: unknown): Promise<T> {
    const { path, options } = query as { path: string; options?: RequestInit };
    return this.fetch<T>(path, options);
  }

  /**
   * Make a Zep API request.
   */
  async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.config.endpoint || ZEP_BASE_URL}${path}`;
    const timeout = this.config.timeout || 15000;

    const resp = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Api-Key ${this.config.apiKey}`,
        ...(options?.headers || {}),
      },
      signal: AbortSignal.timeout(timeout),
    });

    const text = await resp.text();
    let data: unknown;

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Invalid JSON from Zep (${resp.status}): ${text.slice(0, 200)}`);
    }

    if (!resp.ok) {
      const errorData = data as Record<string, unknown>;
      const errorObj = errorData.error as Record<string, unknown> | undefined;
      const errorMsg =
        (errorData.message as string | undefined) ||
        (errorObj?.message as string | undefined) ||
        (errorObj?.detail as string | undefined) ||
        `HTTP ${resp.status}`;
      throw new Error(String(errorMsg));
    }

    return data as T;
  }

  /**
   * Ensure a user exists in Zep.
   */
  async ensureUser(userId: string): Promise<void> {
    try {
      await this.fetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          first_name: 'Lisa',
          last_name: 'Memory',
        }),
      });
    } catch (error) {
      // User already exists is ok
      if (error instanceof Error && error.message.includes('already exists')) {
        return;
      }
      throw error;
    }
  }

  /**
   * Get or create a thread in Zep.
   */
  async getOrCreateThread(threadId: string, userId: string): Promise<void> {
    try {
      await this.fetch('/threads', {
        method: 'POST',
        body: JSON.stringify({
          thread_id: threadId,
          user_id: userId,
          metadata: { project: threadId, created_by: 'lisa' },
        }),
      });
    } catch (error) {
      // Thread already exists is ok
      if (error instanceof Error && error.message.includes('already exists')) {
        return;
      }
      throw error;
    }
  }
}

/**
 * Create a Zep connection manager from environment.
 */
export function createZepConnectionManager(
  apiKey?: string,
  endpoint?: string,
  timeout?: number
): ZepConnectionManager | null {
  const key = apiKey || process.env.ZEP_API_KEY;
  if (!key) {
    return null; // Zep is optional
  }

  const config: IZepConnectionConfig = {
    endpoint: endpoint || ZEP_BASE_URL,
    apiKey: key,
    timeout: timeout || 15000,
  };

  return new ZepConnectionManager(config);
}
