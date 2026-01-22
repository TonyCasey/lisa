/**
 * Unit tests for hooks/types.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrigger } from '../../../../../../../src/lib/application/handlers/hooks/types';

describe('parseTrigger', () => {
  test('returns "startup" for undefined source', () => {
    const result = parseTrigger(undefined, undefined);
    assert.equal(result, 'startup');
  });

  test('returns "startup" when source is "startup"', () => {
    const result = parseTrigger('startup', undefined);
    assert.equal(result, 'startup');
  });

  test('returns "resume" when source is "resume"', () => {
    const result = parseTrigger('resume', undefined);
    assert.equal(result, 'resume');
  });

  test('returns "compact" when source is "compact"', () => {
    const result = parseTrigger('compact', undefined);
    assert.equal(result, 'compact');
  });

  test('returns "clear" when source is "clear"', () => {
    const result = parseTrigger('clear', undefined);
    assert.equal(result, 'clear');
  });

  test('returns "resume" when sessionType is "resume" and source is undefined', () => {
    const result = parseTrigger(undefined, 'resume');
    assert.equal(result, 'resume');
  });

  test('prefers source over sessionType', () => {
    const result = parseTrigger('compact', 'resume');
    assert.equal(result, 'compact');
  });

  test('returns "startup" for unknown source values', () => {
    const result = parseTrigger('unknown', undefined);
    assert.equal(result, 'startup');
  });

  test('returns "startup" for empty string source', () => {
    const result = parseTrigger('', undefined);
    assert.equal(result, 'startup');
  });
});
