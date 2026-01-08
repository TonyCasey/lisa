export {}; // keep scope local

const Table = require('cli-table3');

// Simple ANSI green wrapper to avoid ESM import issues with chalk v5.
const green = (s: string) => `\u001b[32m${s}\u001b[39m`;

const DEFAULT_CHARS: Record<string, string> = {
  'top': '─',
  'top-mid': '┬',
  'top-left': '┌',
  'top-right': '┐',
  'bottom': '─',
  'bottom-mid': '┴',
  'bottom-left': '└',
  'bottom-right': '┘',
  'left': '│',
  'left-mid': '├',
  'mid': '─',
  'mid-mid': '┼',
  'right': '│',
  'right-mid': '┤',
  'middle': '│',
};

type TableConfig = {
  headers?: (string | number)[];
  rows?: any[][];
  colAligns?: string[];
  colWidths?: number[];
  wordWrap?: boolean;
  borderColor?: (s: string) => string;
};

function formatTable({
  headers = [],
  rows = [],
  colAligns = [],
  colWidths = [],
  wordWrap = true,
  borderColor = green,
}: TableConfig = {}) {
  const coloredChars = Object.fromEntries(
    Object.entries(DEFAULT_CHARS).map(([k, v]) => [k, borderColor(v)])
  );
  const safeColWidths = colWidths.length
    ? colWidths
    : headers.length
      ? Array(headers.length).fill(undefined)
      : undefined;
  const table = new Table({
    head: headers,
    colAligns: colAligns.length ? colAligns : Array(headers.length).fill('left'),
    colWidths: safeColWidths,
    wordWrap,
    style: { head: [], border: [] },
    chars: coloredChars,
  });
  rows.forEach((r) => table.push(r));
  return table.toString();
}

function autoFormat(data: unknown) {
  if (!data) return null;
  if (Array.isArray(data) && data.length === 0) return null;

  // Array of primitives
  if (Array.isArray(data) && typeof data[0] !== 'object') {
    return formatTable({ headers: ['Items'], rows: data.map((d) => [String(d)]) });
  }

  // Array of objects with consistent keys
  if (Array.isArray(data) && typeof data[0] === 'object') {
    const keys = Object.keys(data[0]);
    if (!keys.length) return null;
    const headers = keys.slice(0, 6);
    const rows = data.map((row) => headers.map((h) => stringifyCell((row as Record<string, unknown>)[h])));
    return formatTable({ headers, rows });
  }

  return null;
}

function stringifyCell(val: unknown) {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

module.exports = { formatTable, autoFormat };
