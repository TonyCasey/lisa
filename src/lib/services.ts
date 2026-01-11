import fs from 'fs-extra';
import path from 'path';
import { execa } from 'execa';
import { pingMcp } from './mcp';
import { ITemplateCopier } from './interfaces/ITemplateCopier';
import { IDockerClient } from './interfaces/IDockerClient';
import { IMcpClient, PingOptions } from './interfaces/IMcpClient';
import { IServices } from './interfaces/IServices';

class DefaultTemplateCopier implements ITemplateCopier {
  private templateRoot: string;

  constructor(templateRoot: string) {
    this.templateRoot = templateRoot;
  }

  async copy(
    templateRel: string,
    destAbs: string,
    replacements: Record<string, string>,
    force = false,
  ): Promise<{ skipped: boolean }> {
    const src = path.join(this.templateRoot, templateRel);
    if (!(await fs.pathExists(src))) {
      throw new Error(`Missing template ${templateRel}`);
    }
    if (await fs.pathExists(destAbs) && !force) {
      return { skipped: true };
    }
    await fs.ensureDir(path.dirname(destAbs));
    let content = await fs.readFile(src, 'utf8');
    Object.entries(replacements).forEach(([key, value]) => {
      content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
    });
    await fs.writeFile(destAbs, content, 'utf8');
    return { skipped: false };
  }
}

class DefaultDockerClient implements IDockerClient {
  async version(): Promise<string> {
    const { stdout } = await execa('docker', ['--version']);
    return stdout;
  }

  async composeVersion(): Promise<string> {
    const { stdout } = await execa('docker', ['compose', 'version']);
    return stdout;
  }

  async compose(composeFile: string, args: string[], stdio: 'inherit' | 'pipe' = 'inherit'): Promise<void> {
    const composeArgs = ['compose', '-f', composeFile, ...args];
    await execa('docker', composeArgs, { stdio });
  }
}

class DefaultMcpClient implements IMcpClient {
  async ping(endpoint: string, options?: PingOptions): Promise<void> {
    await pingMcp(endpoint, options);
  }
}

export function createDefaultServices(templateRoot: string): IServices {
  return {
    templateCopier: new DefaultTemplateCopier(templateRoot),
    docker: new DefaultDockerClient(),
    mcp: new DefaultMcpClient(),
  };
}

export { ITemplateCopier, IDockerClient, IMcpClient, IServices };
