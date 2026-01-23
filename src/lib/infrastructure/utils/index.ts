/**
 * Infrastructure utilities.
 *
 * Note: Cancellation utilities have been moved to the domain layer
 * (src/lib/domain/utils/cancellation.ts) to allow application-layer usage
 * without violating Clean Architecture. This re-export maintains backward
 * compatibility for infrastructure-layer consumers.
 */
export * from '../../domain/utils/cancellation';
