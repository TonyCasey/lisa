export interface PingOptions {
  apiKey?: string;
}

export interface IMcpClient {
  ping(endpoint: string, options?: PingOptions): Promise<void>;
}
