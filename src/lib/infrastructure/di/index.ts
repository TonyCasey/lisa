/**
 * Dependency injection infrastructure.
 */

// Container
export type { IContainer, IRegistration, IDisposable, Lifetime, Factory, SyncFactory } from './IContainer';
export { Container, createContainer } from './Container';

// Tokens
export { TOKENS, INFRA_TOKENS, APP_TOKENS, CONFIG_TOKENS } from './tokens';
export type { TokenType, Token } from './tokens';

// Bootstrap
export { bootstrapContainer, bootstrapServices } from './bootstrap';
export type { IBootstrapResult } from './bootstrap';

// Legacy ServiceFactory (deprecated - use bootstrapContainer instead)
export {
  IServiceConfig,
  IServicesWithCleanup,
  createServices,
  createServicesWithCleanup,
} from './ServiceFactory';
