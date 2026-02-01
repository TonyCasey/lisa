/**
 * DI Container Tokens.
 *
 * Symbols used to register and resolve services from the container.
 * Grouped by layer (infrastructure, domain, application).
 */

/**
 * Infrastructure layer tokens.
 */
export const INFRA_TOKENS = {
  // Core
  Logger: Symbol.for('Lisa.Logger'),
  McpClient: Symbol.for('Lisa.McpClient'),
  
  // Context
  Context: Symbol.for('Lisa.Context'),
  
  // DAL
  RepositoryRouter: Symbol.for('Lisa.RepositoryRouter'),
  ConnectionManagers: Symbol.for('Lisa.ConnectionManagers'),
  
  // Services
  MemoryService: Symbol.for('Lisa.MemoryService'),
  TaskService: Symbol.for('Lisa.TaskService'),
  EventEmitter: Symbol.for('Lisa.EventEmitter'),
  SessionCaptureService: Symbol.for('Lisa.SessionCaptureService'),
  RecursionService: Symbol.for('Lisa.RecursionService'),
  GitHubSyncService: Symbol.for('Lisa.GitHubSyncService'),
  DeduplicationService: Symbol.for('Lisa.DeduplicationService'),
  CurationService: Symbol.for('Lisa.CurationService'),
  ConsolidationService: Symbol.for('Lisa.ConsolidationService'),
  PreferenceStore: Symbol.for('Lisa.PreferenceStore'),
  LlmConfigService: Symbol.for('Lisa.LlmConfigService'),
  LlmService: Symbol.for('Lisa.LlmService'),
} as const;

/**
 * Application layer tokens.
 */
export const APP_TOKENS = {
  // Mediator
  Mediator: Symbol.for('Lisa.Mediator'),
  
  // Handlers
  SessionStartHandler: Symbol.for('Lisa.SessionStartHandler'),
  SessionStopHandler: Symbol.for('Lisa.SessionStopHandler'),
  PromptSubmitHandler: Symbol.for('Lisa.PromptSubmitHandler'),
} as const;

/**
 * Configuration tokens.
 */
export const CONFIG_TOKENS = {
  ServiceConfig: Symbol.for('Lisa.ServiceConfig'),
  ProjectRoot: Symbol.for('Lisa.ProjectRoot'),
  McpEndpoint: Symbol.for('Lisa.McpEndpoint'),
  ApiKey: Symbol.for('Lisa.ApiKey'),
} as const;

/**
 * All tokens combined for convenience.
 */
export const TOKENS = {
  ...INFRA_TOKENS,
  ...APP_TOKENS,
  ...CONFIG_TOKENS,
} as const;

/**
 * Type helper for token values.
 */
export type TokenType = typeof TOKENS;
export type Token = TokenType[keyof TokenType];
