/**
 * Dependency injection infrastructure.
 *
 * Composition root: bootstrapContainer() in bootstrap.ts
 * This is the single entry point for creating application-level services
 * (memory, tasks, context, handlers, mediator, etc.) used by hooks and handlers.
 *
 * For CLI-specific services (template copier, Docker, MCP ping),
 * see createCliServices() in src/lib/commands/cli-services.ts.
 */

// Container
export type { IContainer, IRegistration, IDisposable, Lifetime, Factory, SyncFactory } from './IContainer';
export { Container, createContainer } from './Container';

// Tokens
export { TOKENS, INFRA_TOKENS, APP_TOKENS, CONFIG_TOKENS } from './tokens';
export type { TokenType, Token } from './tokens';

// Bootstrap (composition root)
export { bootstrapContainer } from './bootstrap';
export type { IBootstrapResult } from './bootstrap';

// Service configuration
export { IServiceConfig } from './ServiceFactory';
