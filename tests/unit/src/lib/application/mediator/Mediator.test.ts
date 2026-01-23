/**
 * Unit tests for the Mediator.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Mediator, createMediator } from '../../../../../../src/lib/application/mediator/Mediator';
import type { IRequest, IRequestHandler, IMediator } from '../../../../../../src/lib/application/mediator/IMediator';

// Test request/response types
interface TestResponse {
  value: number;
}

class TestRequest implements IRequest<TestResponse> {
  readonly __responseType?: TestResponse;
  constructor(public readonly input: number) {}
}

class TestHandler implements IRequestHandler<TestRequest, TestResponse> {
  public callCount = 0;

  async handle(request: TestRequest): Promise<TestResponse> {
    this.callCount++;
    return { value: request.input * 2 };
  }
}

// Another request type for testing multiple registrations
interface AnotherResponse {
  message: string;
}

class AnotherRequest implements IRequest<AnotherResponse> {
  readonly __responseType?: AnotherResponse;
  constructor(public readonly text: string) {}
}

class AnotherHandler implements IRequestHandler<AnotherRequest, AnotherResponse> {
  async handle(request: AnotherRequest): Promise<AnotherResponse> {
    return { message: `Hello, ${request.text}!` };
  }
}

describe('Mediator', () => {
  let mediator: Mediator;

  beforeEach(() => {
    mediator = new Mediator();
  });

  describe('register and send', () => {
    it('should send request to registered handler', async () => {
      const handler = new TestHandler();
      mediator.register(TestRequest, handler);

      const response = await mediator.send(new TestRequest(21));

      assert.strictEqual(response.value, 42);
      assert.strictEqual(handler.callCount, 1);
    });

    it('should handle multiple request types', async () => {
      mediator.register(TestRequest, new TestHandler());
      mediator.register(AnotherRequest, new AnotherHandler());

      const testResponse = await mediator.send(new TestRequest(5));
      const anotherResponse = await mediator.send(new AnotherRequest('World'));

      assert.strictEqual(testResponse.value, 10);
      assert.strictEqual(anotherResponse.message, 'Hello, World!');
    });

    it('should throw when no handler registered', async () => {
      await assert.rejects(
        () => mediator.send(new TestRequest(1)),
        /No handler registered for request type: TestRequest/
      );
    });

    it('should throw when registering duplicate handler', () => {
      mediator.register(TestRequest, new TestHandler());

      assert.throws(
        () => mediator.register(TestRequest, new TestHandler()),
        /Handler already registered for request type: TestRequest/
      );
    });
  });

  describe('isRegistered', () => {
    it('should return true for registered request types', () => {
      mediator.register(TestRequest, new TestHandler());

      assert.strictEqual(mediator.isRegistered(TestRequest), true);
    });

    it('should return false for unregistered request types', () => {
      assert.strictEqual(mediator.isRegistered(TestRequest), false);
    });
  });

  describe('handler isolation', () => {
    it('should call the correct handler for each request type', async () => {
      const testHandler = new TestHandler();
      const anotherHandler = new AnotherHandler();

      mediator.register(TestRequest, testHandler);
      mediator.register(AnotherRequest, anotherHandler);

      // Send multiple requests of different types
      await mediator.send(new TestRequest(1));
      await mediator.send(new TestRequest(2));
      await mediator.send(new AnotherRequest('test'));

      // Test handler should have been called twice
      assert.strictEqual(testHandler.callCount, 2);
    });
  });
});

describe('createMediator', () => {
  it('should create a new Mediator instance', () => {
    const mediator = createMediator();

    assert.ok(mediator);
    assert.strictEqual(typeof mediator.send, 'function');
    assert.strictEqual(typeof mediator.register, 'function');
  });
});
