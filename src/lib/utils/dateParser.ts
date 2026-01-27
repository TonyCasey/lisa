/**
 * Date parsing utilities for CLI commands.
 * Supports relative dates (today, yesterday, 7d, 1w, 1m) and ISO formats.
 */

/**
 * Parse a date string into a Date object.
 * Supports:
 * - Relative dates: "today", "yesterday", "7d", "1w", "1m", "3h"
 * - ISO dates: "2026-01-27", "2026-01-27T10:00:00Z"
 *
 * @param dateStr - Date string to parse
 * @returns Parsed Date object or null if invalid
 */
export function parseDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  const input = dateStr.trim().toLowerCase();

  // Handle relative dates
  const now = new Date();

  if (input === 'today') {
    return getStartOfDay(now);
  }

  if (input === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return getStartOfDay(yesterday);
  }

  // Handle relative time patterns: 7d, 1w, 1m, 3h, 30m
  const relativeMatch = input.match(/^(\d+)([hdwm])$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    return subtractTime(now, value, unit);
  }

  // Try parsing as ISO date
  try {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  } catch {
    // Fall through to return null
  }

  return null;
}

/**
 * Get the start of day (midnight) for a given date.
 *
 * @param date - Date to get start of day for
 * @returns New Date object set to midnight
 */
export function getStartOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get the start of today (midnight).
 *
 * @returns Date object set to today at midnight
 */
export function getStartOfToday(): Date {
  return getStartOfDay(new Date());
}

/**
 * Get a date representing N hours ago.
 *
 * @param hours - Number of hours ago
 * @returns Date object
 */
export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/**
 * Subtract time from a date based on unit.
 *
 * @param date - Base date
 * @param value - Amount to subtract
 * @param unit - Time unit (h=hours, d=days, w=weeks, m=months)
 * @returns New Date object with time subtracted
 */
function subtractTime(date: Date, value: number, unit: string): Date {
  const result = new Date(date);

  switch (unit) {
    case 'h':
      result.setHours(result.getHours() - value);
      break;
    case 'd':
      result.setDate(result.getDate() - value);
      break;
    case 'w':
      result.setDate(result.getDate() - value * 7);
      break;
    case 'm':
      result.setMonth(result.getMonth() - value);
      break;
  }

  return result;
}

/**
 * Format a date for display in CLI output.
 *
 * @param date - Date to format
 * @returns Formatted string (e.g., "Jan 27" or "Jan 27, 2026")
 */
export function formatDateForDisplay(date: Date): string {
  const now = new Date();
  const isCurrentYear = date.getFullYear() === now.getFullYear();

  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();

  if (isCurrentYear) {
    return `${month} ${day}`;
  }
  return `${month} ${day}, ${date.getFullYear()}`;
}

/**
 * Format a date range for display.
 *
 * @param since - Start date
 * @param until - End date (optional, defaults to now)
 * @returns Formatted string describing the range
 */
export function formatDateRange(since: Date, until?: Date): string {
  const end = until || new Date();
  const sinceStr = formatDateForDisplay(since);
  const untilStr = formatDateForDisplay(end);

  if (sinceStr === untilStr) {
    return sinceStr;
  }

  return `${sinceStr} - ${untilStr}`;
}
