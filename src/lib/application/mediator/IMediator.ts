/**
 * Mediator Pattern Interfaces.
 *
 * The Mediator pattern provides a single entry point for all requests.
 * Each request type maps to exactly one handler.
 *
 * This is different from events (fire-and-forget, multiple subscribers).
 * Requests are "do something and return a result" (single handler, response required).
 */

/**
 * Marker interface for requests.
 * The generic parameter TResponse indicates what the handler returns.
 *
 * @example
 * class GetUserRequest implements IRequest<User> {
 *   constructor(public readonly userId: string) {}
 * }
 */
export interface IRequest<TResponse = void> {
  /**
   * Phantom type to carry the response type.
   * Not used at runtime, only for type inference.
   */
  readonly __responseType?: TResponse;
}

/**
 * Handler for a specific request type.
 *
 * @example
 * class GetUserHandler implements IRequestHandler<GetUserRequest, User> {
 *   async handle(request: GetUserRequest): Promise<User> {
 *     return this.userRepository.findById(request.userId);
 *   }
 * }
 */
export interface IRequestHandler<TRequest extends IRequest<TResponse>, TResponse> {
  /**
   * Handle the request and return a response.
   */
  handle(request: TRequest): Promise<TResponse>;
}

/**
 * Request type constructor.
 * Used for registering handlers by request class.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface IRequestType<TRequest extends IRequest<TResponse>, TResponse = unknown> {
  new (...args: any[]): TRequest;
}

/**
 * Mediator interface.
 * Routes requests to their registered handlers.
 */
export interface IMediator {
  /**
   * Send a request to its handler and return the response.
   *
   * @param request - The request to handle
   * @returns The handler's response
   * @throws Error if no handler is registered for the request type
   *
   * @example
   * const user = await mediator.send(new GetUserRequest('123'));
   */
  send<TResponse>(request: IRequest<TResponse>): Promise<TResponse>;

  /**
   * Register a handler for a request type.
   *
   * @param requestType - The request class constructor
   * @param handler - The handler instance
   */
  register<TRequest extends IRequest<TResponse>, TResponse>(
    requestType: IRequestType<TRequest, TResponse>,
    handler: IRequestHandler<TRequest, TResponse>
  ): void;
}
