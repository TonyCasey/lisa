/**
 * Docker Command Module
 *
 * Provides commands for managing Docker Compose services (Neo4j, Graphiti MCP).
 */

import type { IServices } from '../interfaces/IServices';

// ============================================================================
// Command Options
// ============================================================================

export interface IDockerOptions {
  composeFile: string;
}

// ============================================================================
// Command Implementations
// ============================================================================

/**
 * Start Docker Compose services.
 * Runs `docker compose up -d` with the specified compose file.
 */
export async function upCommand(opts: IDockerOptions, services: IServices): Promise<void> {
  await services.docker.compose(opts.composeFile, ['up', '-d']);
}

/**
 * Stop Docker Compose services.
 * Runs `docker compose down` with the specified compose file.
 */
export async function downCommand(opts: IDockerOptions, services: IServices): Promise<void> {
  await services.docker.compose(opts.composeFile, ['down']);
}
