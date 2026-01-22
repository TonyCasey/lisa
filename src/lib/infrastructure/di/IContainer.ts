/**
 * Dependency Injection Container Interface.
 *
 * Supports three lifetime scopes:
 * - singleton: One instance for the container's lifetime
 * - scoped: One instance per child scope
 * - transient: New instance on every resolve
 */

/**
 * Service lifetime scope.
 */
export type Lifetime = 'singleton' | 'scoped' | 'transient';

/**
 * Factory function that creates a service instance.
 */
export type Factory<T> = () => Promise<T>;

/**
 * Synchronous factory function.
 */
export type SyncFactory<T> = () => T;

/**
 * Service registration metadata.
 */
export interface IRegistration<T = unknown> {
  readonly factory: Factory<T>;
  readonly lifetime: Lifetime;
}

/**
 * Disposable interface for services that need cleanup.
 */
export interface IDisposable {
  dispose(): Promise<void>;
}

/**
 * DI Container interface.
 */
export interface IContainer {
  /**
   * Register a service factory with a lifetime scope.
   *
   * @param token - Unique symbol identifying the service
   * @param factory - Async factory function that creates the service
   * @param lifetime - How long the instance should live
   */
  register<T>(token: symbol, factory: Factory<T>, lifetime: Lifetime): void;

  /**
   * Register a service factory synchronously.
   *
   * @param token - Unique symbol identifying the service
   * @param factory - Sync factory function that creates the service
   * @param lifetime - How long the instance should live
   */
  registerSync<T>(token: symbol, factory: SyncFactory<T>, lifetime: Lifetime): void;

  /**
   * Register an existing instance as a singleton.
   *
   * @param token - Unique symbol identifying the service
   * @param instance - The instance to register
   */
  registerInstance<T>(token: symbol, instance: T): void;

  /**
   * Resolve a service by its token.
   *
   * @param token - The service token to resolve
   * @returns The service instance
   * @throws Error if the token is not registered
   */
  resolve<T>(token: symbol): Promise<T>;

  /**
   * Check if a service is registered.
   *
   * @param token - The service token to check
   */
  isRegistered(token: symbol): boolean;

  /**
   * Create a child scope for scoped services.
   * Singletons are shared with the parent.
   * Scoped services get new instances in the child.
   */
  createScope(): IContainer;

  /**
   * Dispose the container and all disposable singletons.
   * Child scopes should be disposed before their parent.
   */
  dispose(): Promise<void>;
}
