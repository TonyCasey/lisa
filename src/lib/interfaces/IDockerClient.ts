export interface IDockerClient {
  version(): Promise<string>;
  composeVersion(): Promise<string>;
  compose(composeFile: string, args: string[], stdio?: 'inherit' | 'pipe'): Promise<void>;
}
