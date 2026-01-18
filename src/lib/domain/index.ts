/**
 * Domain Layer
 * 
 * Contains pure types, interfaces, events, and errors.
 * This layer has ZERO dependencies - it only defines contracts.
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
