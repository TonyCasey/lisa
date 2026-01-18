/**
 * Application Layer
 * 
 * Contains handlers (use cases) that orchestrate domain services.
 * This layer depends on Domain only.
 * 
 * Layer Dependencies:
 *   Domain <- Application <- Infrastructure
 *   (Application depends on Domain only)
 */

// Handlers
export * from './handlers';

// Interfaces
export * from './interfaces';
