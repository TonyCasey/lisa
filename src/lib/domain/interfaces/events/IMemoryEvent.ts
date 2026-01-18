import type { ISOTimestamp } from '../../types';

/**
 * Event emitted when memory is loaded.
 */
export interface IMemoryLoadEvent {
  readonly type: 'memory:load';
  readonly groupId: string;
  readonly timestamp: ISOTimestamp;
}

/**
 * Event emitted when memory is saved.
 */
export interface IMemorySaveEvent {
  readonly type: 'memory:save';
  readonly facts: readonly string[];
  readonly groupId: string;
  readonly timestamp: ISOTimestamp;
}

/**
 * Create a memory load event.
 */
export function createMemoryLoadEvent(
  groupId: string,
  timestamp: ISOTimestamp
): IMemoryLoadEvent {
  return {
    type: 'memory:load',
    groupId,
    timestamp,
  };
}

/**
 * Create a memory save event.
 */
export function createMemorySaveEvent(
  facts: readonly string[],
  groupId: string,
  timestamp: ISOTimestamp
): IMemorySaveEvent {
  return {
    type: 'memory:save',
    facts,
    groupId,
    timestamp,
  };
}
