/**
 * Unit tests for the DI Container.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Container, createContainer } from '../../../../../../src/lib/infrastructure/di/Container';
import type { IContainer, IDisposable } from '../../../../../../src/lib/infrastructure/di/IContainer';

describe('Container', () => {
  let container: IContainer;

  beforeEach(() => {
    container = createContainer();
  });

  describe('register and resolve', () => {
    it('should resolve a registered transient service', async () => {
      const token = Symbol('test');
      let callCount = 0;

      container.register(token, async () => {
        callCount++;
        return { value: callCount };
      }, 'transient');

      const first = await container.resolve<{ value: number }>(token);
      const second = await container.resolve<{ value: number }>(token);

      assert.strictEqual(first.value, 1);
      assert.strictEqual(second.value, 2);
      assert.strictEqual(callCount, 2, 'Transient should create new instance each time');
    });

    it('should resolve a registered singleton service once', async () => {
      const token = Symbol('test');
      let callCount = 0;

      container.register(token, async () => {
        callCount++;
        return { value: callCount };
      }, 'singleton');

      const first = await container.resolve<{ value: number }>(token);
      const second = await container.resolve<{ value: number }>(token);

      assert.strictEqual(first.value, 1);
      assert.strictEqual(second.value, 1);
      assert.strictEqual(first, second, 'Singleton should return same instance');
      assert.strictEqual(callCount, 1, 'Singleton factory should be called once');
    });

    it('should throw when resolving unregistered service', async () => {
      const token = Symbol('unregistered');

      await assert.rejects(
        () => container.resolve(token),
        /Service not registered/
      );
    });
  });

  describe('registerSync', () => {
    it('should wrap sync factory as async', async () => {
      const token = Symbol('sync');

      container.registerSync(token, () => ({ value: 42 }), 'singleton');

      const result = await container.resolve<{ value: number }>(token);
      assert.strictEqual(result.value, 42);
    });
  });

  describe('registerInstance', () => {
    it('should register an existing instance as singleton', async () => {
      const token = Symbol('instance');
      const instance = { value: 'preset' };

      container.registerInstance(token, instance);

      const resolved = await container.resolve<{ value: string }>(token);
      assert.strictEqual(resolved, instance);
      assert.strictEqual(resolved.value, 'preset');
    });
  });

  describe('isRegistered', () => {
    it('should return true for registered services', () => {
      const token = Symbol('test');
      container.registerSync(token, () => ({}), 'transient');

      assert.strictEqual(container.isRegistered(token), true);
    });

    it('should return false for unregistered services', () => {
      const token = Symbol('unknown');

      assert.strictEqual(container.isRegistered(token), false);
    });
  });

  describe('scoped lifetime', () => {
    it('should create one instance per scope', async () => {
      const token = Symbol('scoped');
      let callCount = 0;

      container.register(token, async () => {
        callCount++;
        return { id: callCount };
      }, 'scoped');

      // Root scope
      const root1 = await container.resolve<{ id: number }>(token);
      const root2 = await container.resolve<{ id: number }>(token);

      assert.strictEqual(root1, root2, 'Same scope should return same instance');
      assert.strictEqual(callCount, 1);

      // Child scope
      const childScope = container.createScope();
      const child1 = await childScope.resolve<{ id: number }>(token);
      const child2 = await childScope.resolve<{ id: number }>(token);

      assert.strictEqual(child1, child2, 'Same child scope should return same instance');
      assert.notStrictEqual(child1, root1, 'Different scopes should have different instances');
      assert.strictEqual(callCount, 2);
    });
  });

  describe('createScope', () => {
    it('should inherit registrations from parent', async () => {
      const token = Symbol('inherited');
      container.registerSync(token, () => ({ value: 'parent' }), 'transient');

      const childScope = container.createScope();
      const resolved = await childScope.resolve<{ value: string }>(token);

      assert.strictEqual(resolved.value, 'parent');
    });

    it('should share singletons with parent', async () => {
      const token = Symbol('shared-singleton');
      let callCount = 0;

      container.register(token, async () => {
        callCount++;
        return { id: callCount };
      }, 'singleton');

      const parentInstance = await container.resolve<{ id: number }>(token);
      
      const childScope = container.createScope();
      const childInstance = await childScope.resolve<{ id: number }>(token);

      assert.strictEqual(parentInstance, childInstance, 'Singletons should be shared');
      assert.strictEqual(callCount, 1, 'Singleton factory called once');
    });
  });

  describe('dispose', () => {
    it('should dispose disposable singletons', async () => {
      const token = Symbol('disposable');
      let disposed = false;

      const disposable: IDisposable = {
        dispose: async () => {
          disposed = true;
        },
      };

      container.registerInstance(token, disposable);
      await container.resolve(token);

      await container.dispose();

      assert.strictEqual(disposed, true, 'Disposable should be disposed');
    });

    it('should throw when resolving after dispose', async () => {
      const token = Symbol('test');
      container.registerSync(token, () => ({}), 'transient');

      await container.dispose();

      await assert.rejects(
        () => container.resolve(token),
        /Container has been disposed/
      );
    });

    it('should be idempotent', async () => {
      let disposeCount = 0;
      const token = Symbol('test');

      container.registerInstance(token, {
        dispose: async () => {
          disposeCount++;
        },
      });

      await container.dispose();
      await container.dispose();

      assert.strictEqual(disposeCount, 1, 'Dispose should only run once');
    });

    it('should dispose scoped instances in child scope', async () => {
      const token = Symbol('scoped-disposable');
      let disposed = false;

      container.register(token, async () => ({
        dispose: async () => {
          disposed = true;
        },
      }), 'scoped');

      const childScope = container.createScope();
      await childScope.resolve(token);

      await childScope.dispose();

      assert.strictEqual(disposed, true, 'Scoped disposable should be disposed');
    });
  });
});

describe('createContainer', () => {
  it('should create a new container instance', () => {
    const container = createContainer();
    assert.ok(container);
    assert.strictEqual(typeof container.register, 'function');
    assert.strictEqual(typeof container.resolve, 'function');
  });
});
