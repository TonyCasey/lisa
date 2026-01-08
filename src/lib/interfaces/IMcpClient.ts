export interface IMcpClient {
  ping(endpoint: string): Promise<void>;
}
