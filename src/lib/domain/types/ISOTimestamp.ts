/**
 * ISO 8601 timestamp string type.
 * 
 * All timestamps at event/API boundaries are ISO strings.
 * Core handlers parse to Date internally when needed.
 * 
 * @example "2024-01-15T10:30:00.000Z"
 */
export type ISOTimestamp = string;

/**
 * Convert a Date to ISO timestamp string.
 * Defaults to current time if no date provided.
 */
export function toISOTimestamp(date: Date = new Date()): ISOTimestamp {
  return date.toISOString();
}

/**
 * Parse an ISO timestamp string to Date.
 */
export function parseTimestamp(iso: ISOTimestamp): Date {
  return new Date(iso);
}
