import { ITemplateCopier } from './ITemplateCopier';
import { IDockerClient } from './IDockerClient';
import { IMcpClient } from './IMcpClient';

export interface IServices {
  templateCopier: ITemplateCopier;
  docker: IDockerClient;
  mcp: IMcpClient;
}
