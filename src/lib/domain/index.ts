/**
 * Domain Layer
 * 
 * Contains pure types, interfaces, events, errors, and domain utilities.
 * This layer has ZERO dependencies - it only defines contracts and
 * domain-agnostic utilities.
 * 
 * Layer Dependencies:
 *   Domain <- Application <- Infrastructure
 *   (Domain depends on nothing)
 */

// Types (non-interface types like ISOTimestamp)
export * from './types';

// Interfaces (includes events and type interfaces)
export * from './interfaces';

// Errors
export * from './errors';

// Domain utilities (cancellation, etc.)
export * from './utils';
