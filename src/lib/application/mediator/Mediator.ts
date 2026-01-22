/**
 * Mediator Implementation.
 *
 * Routes requests to their registered handlers.
 */

import type { IMediator, IRequest, IRequestHandler, IRequestType } from './IMediator';

/**
 * Mediator implementation.
 */
export class Mediator implements IMediator {
  private readonly handlers = new Map<
    IRequestType<IRequest<unknown>, unknown>,
    IRequestHandler<IRequest<unknown>, unknown>
  >();

  /**
   * Send a request to its handler.
   */
  async send<TResponse>(request: IRequest<TResponse>): Promise<TResponse> {
    const requestType = request.constructor as IRequestType<IRequest<TResponse>, TResponse>;
    const handler = this.handlers.get(requestType) as IRequestHandler<IRequest<TResponse>, TResponse> | undefined;

    if (!handler) {
      const name = requestType.name || 'UnknownRequest';
      throw new Error(`No handler registered for request type: ${name}`);
    }

    return handler.handle(request);
  }

  /**
   * Register a handler for a request type.
   */
  register<TRequest extends IRequest<TResponse>, TResponse>(
    requestType: IRequestType<TRequest, TResponse>,
    handler: IRequestHandler<TRequest, TResponse>
  ): void {
    if (this.handlers.has(requestType as IRequestType<IRequest<unknown>, unknown>)) {
      const name = requestType.name || 'UnknownRequest';
      throw new Error(`Handler already registered for request type: ${name}`);
    }

    this.handlers.set(
      requestType as IRequestType<IRequest<unknown>, unknown>,
      handler as IRequestHandler<IRequest<unknown>, unknown>
    );
  }

  /**
   * Check if a handler is registered for a request type.
   */
  isRegistered<TRequest extends IRequest<TResponse>, TResponse>(
    requestType: IRequestType<TRequest, TResponse>
  ): boolean {
    return this.handlers.has(requestType as IRequestType<IRequest<unknown>, unknown>);
  }
}

/**
 * Create a new Mediator instance.
 */
export function createMediator(): IMediator {
  return new Mediator();
}
