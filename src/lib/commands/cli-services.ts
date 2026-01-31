/**
 * CLI Services Module
 *
 * Provides infrastructure services used by CLI commands (init, doctor, up, down).
 * These are distinct from the application-level DI container (bootstrapContainer)
 * which provides memory, tasks, context, and other core Lisa services for hooks.
 *
 * Composition roots:
 * - CLI commands  → createCliServices()  (this module)
 * - Hooks/handlers → bootstrapContainer() (src/lib/infrastructure/di/bootstrap.ts)
 */

import fs from 'fs-extra';
import path from 'path';
import {execa} from 'execa';
import {pingMcp, type PingMcpOptions} from '../mcp';

// ============================================================================
// Interfaces
// ============================================================================

export interface ITemplateCopier {
  copy(
    templateRel: string,
    destAbs: string,
    replacements: Record<string, string>,
    force?: boolean,
  ): Promise<{skipped: boolean}>;
}

export interface IDockerClient {
  version(): Promise<string>;
  composeVersion(): Promise<string>;
  compose(composeFile: string, args: string[], stdio?: 'inherit' | 'pipe'): Promise<void>;
}

export interface IMcpPingClient {
  ping(endpoint: string, options?: PingMcpOptions): Promise<void>;
}

/**
 * Service container for CLI commands (init, doctor, up, down).
 *
 * NOT the same as ILisaServices (application-level services for hooks/handlers).
 * These services provide CLI infrastructure: template copying, Docker management,
 * and MCP endpoint health checks.
 */
export interface ICliServices {
  templateCopier: ITemplateCopier;
  docker: IDockerClient;
  mcp: IMcpPingClient;
}

// ============================================================================
// Implementations
// ============================================================================

class TemplateCopier implements ITemplateCopier {
  constructor(private readonly templateRoot: string) {}

  async copy(
    templateRel: string,
    destAbs: string,
    replacements: Record<string, string>,
    force = false,
  ): Promise<{skipped: boolean}> {
    const src = path.join(this.templateRoot, templateRel);
    if (!(await fs.pathExists(src))) {
      throw new Error(`Missing template ${templateRel}`);
    }
    if (await fs.pathExists(destAbs) && !force) {
      return {skipped: true};
    }
    await fs.ensureDir(path.dirname(destAbs));
    let content = await fs.readFile(src, 'utf8');
    Object.entries(replacements).forEach(([key, value]) => {
      content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
    });
    await fs.writeFile(destAbs, content, 'utf8');
    return {skipped: false};
  }
}

class DockerClient implements IDockerClient {
  async version(): Promise<string> {
    const {stdout} = await execa('docker', ['--version']);
    return stdout;
  }

  async composeVersion(): Promise<string> {
    const {stdout} = await execa('docker', ['compose', 'version']);
    return stdout;
  }

  async compose(composeFile: string, args: string[], stdio: 'inherit' | 'pipe' = 'inherit'): Promise<void> {
    const composeArgs = ['compose', '-f', composeFile, ...args];
    await execa('docker', composeArgs, {stdio});
  }
}

class McpPingClient implements IMcpPingClient {
  async ping(endpoint: string, options?: PingMcpOptions): Promise<void> {
    await pingMcp(endpoint, options);
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create CLI infrastructure services.
 *
 * This is the composition root for CLI commands (init, doctor, up, down).
 * For application-level services (memory, tasks, context), use
 * bootstrapContainer() from src/lib/infrastructure/di/bootstrap.ts instead.
 *
 * @param templateRoot - Path to the project template directory
 * @returns CLI services container
 */
export function createCliServices(templateRoot: string): ICliServices {
  return {
    templateCopier: new TemplateCopier(templateRoot),
    docker: new DockerClient(),
    mcp: new McpPingClient(),
  };
}
