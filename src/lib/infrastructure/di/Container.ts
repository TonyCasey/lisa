/**
 * Lightweight DI Container Implementation.
 *
 * Supports singleton, scoped, and transient lifetimes.
 * Async-first design for services that require initialization.
 */

import type {
  IContainer,
  IRegistration,
  IDisposable,
  Lifetime,
  Factory,
  SyncFactory,
} from './IContainer';

/**
 * Check if an object implements IDisposable.
 */
function isDisposable(obj: unknown): obj is IDisposable {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'dispose' in obj &&
    typeof (obj as IDisposable).dispose === 'function'
  );
}

/**
 * Lightweight DI Container.
 */
export class Container implements IContainer {
  private readonly registrations = new Map<symbol, IRegistration>();
  private readonly singletons = new Map<symbol, unknown>();
  private readonly scopedInstances = new Map<symbol, unknown>();
  private readonly parent: Container | null;
  private disposed = false;

  constructor(parent: Container | null = null) {
    this.parent = parent;
  }

  /**
   * Register a service factory with a lifetime scope.
   */
  register<T>(token: symbol, factory: Factory<T>, lifetime: Lifetime): void {
    this.ensureNotDisposed();
    this.registrations.set(token, { factory, lifetime });
  }

  /**
   * Register a synchronous factory (wrapped as async).
   */
  registerSync<T>(token: symbol, factory: SyncFactory<T>, lifetime: Lifetime): void {
    this.ensureNotDisposed();
    const asyncFactory: Factory<T> = () => Promise.resolve(factory());
    this.registrations.set(token, { factory: asyncFactory, lifetime });
  }

  /**
   * Register an existing instance as a singleton.
   */
  registerInstance<T>(token: symbol, instance: T): void {
    this.ensureNotDisposed();
    // Create a factory that returns the instance
    const factory: Factory<T> = () => Promise.resolve(instance);
    this.registrations.set(token, { factory, lifetime: 'singleton' });
    // Store immediately in singletons cache
    this.singletons.set(token, instance);
  }

  /**
   * Resolve a service by its token.
   */
  async resolve<T>(token: symbol): Promise<T> {
    this.ensureNotDisposed();

    // Check local registration first, then parent
    const registration = this.getRegistration<T>(token);
    if (!registration) {
      throw new Error(`Service not registered: ${token.description || token.toString()}`);
    }

    switch (registration.lifetime) {
      case 'singleton':
        return this.resolveSingleton<T>(token, registration);

      case 'scoped':
        return this.resolveScoped<T>(token, registration);

      case 'transient':
        return registration.factory() as Promise<T>;

      default:
        throw new Error(`Unknown lifetime: ${registration.lifetime}`);
    }
  }

  /**
   * Check if a service is registered (including parent).
   */
  isRegistered(token: symbol): boolean {
    if (this.registrations.has(token)) {
      return true;
    }
    return this.parent?.isRegistered(token) ?? false;
  }

  /**
   * Create a child scope.
   * Singletons are shared, scoped services get fresh instances.
   */
  createScope(): IContainer {
    this.ensureNotDisposed();
    return new Container(this);
  }

  /**
   * Dispose the container and all disposable services.
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    // Dispose scoped instances first
    for (const instance of this.scopedInstances.values()) {
      if (isDisposable(instance)) {
        await instance.dispose();
      }
    }
    this.scopedInstances.clear();

    // Dispose singletons (only if we're the root container)
    if (!this.parent) {
      for (const instance of this.singletons.values()) {
        if (isDisposable(instance)) {
          await instance.dispose();
        }
      }
      this.singletons.clear();
    }

    this.registrations.clear();
  }

  /**
   * Get registration from this container or parent.
   */
  private getRegistration<T>(token: symbol): IRegistration<T> | undefined {
    const local = this.registrations.get(token) as IRegistration<T> | undefined;
    if (local) {
      return local;
    }
    return this.parent?.getRegistration<T>(token);
  }

  /**
   * Resolve a singleton (shared with parent if exists).
   */
  private async resolveSingleton<T>(token: symbol, registration: IRegistration<T>): Promise<T> {
    // For singletons, always use root container's cache
    const root = this.getRoot();

    if (root.singletons.has(token)) {
      return root.singletons.get(token) as T;
    }

    const instance = await registration.factory();
    root.singletons.set(token, instance);
    return instance;
  }

  /**
   * Resolve a scoped instance (per-scope).
   */
  private async resolveScoped<T>(token: symbol, registration: IRegistration<T>): Promise<T> {
    if (this.scopedInstances.has(token)) {
      return this.scopedInstances.get(token) as T;
    }

    const instance = await registration.factory();
    this.scopedInstances.set(token, instance);
    return instance;
  }

  /**
   * Get the root container.
   */
  private getRoot(): Container {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Container = this;
    while (current.parent) {
      current = current.parent;
    }
    return current;
  }

  /**
   * Throw if disposed.
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Container has been disposed');
    }
  }
}

/**
 * Create a new root container.
 */
export function createContainer(): IContainer {
  return new Container();
}
