import type { ISOTimestamp } from '../../types';

/**
 * Event emitted when memory is loaded.
 *
 * Note: Group IDs are no longer used - the git repo provides scoping via git-mem.
 */
export interface IMemoryLoadEvent {
  readonly type: 'memory:load';
  readonly timestamp: ISOTimestamp;
}

/**
 * Event emitted when memory is saved.
 *
 * Note: Group IDs are no longer used - the git repo provides scoping via git-mem.
 */
export interface IMemorySaveEvent {
  readonly type: 'memory:save';
  readonly facts: readonly string[];
  readonly timestamp: ISOTimestamp;
}

/**
 * Create a memory load event.
 */
export function createMemoryLoadEvent(
  timestamp: ISOTimestamp
): IMemoryLoadEvent {
  return {
    type: 'memory:load',
    timestamp,
  };
}

/**
 * Create a memory save event.
 */
export function createMemorySaveEvent(
  facts: readonly string[],
  timestamp: ISOTimestamp
): IMemorySaveEvent {
  return {
    type: 'memory:save',
    facts,
    timestamp,
  };
}
