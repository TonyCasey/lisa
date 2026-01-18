/**
 * OpenCode Event Name Constants
 * 
 * Use these instead of magic strings throughout the codebase.
 * Based on OpenCode's hook/event system.
 */
export const OpenCodeEventNames = {
  // Session lifecycle
  SESSION_CREATED: 'session.created',
  SESSION_UPDATED: 'session.updated',
  SESSION_DELETED: 'session.deleted',
  SESSION_IDLE: 'session.idle',
  SESSION_COMPACTED: 'session.compacted',
  SESSION_ERROR: 'session.error',

  // Message events
  MESSAGE_UPDATED: 'message.updated',

  // Tool events
  TOOL_EXECUTE_BEFORE: 'tool.execute.before',
  TOOL_EXECUTE_AFTER: 'tool.execute.after',

  // Compaction hook (for injecting context)
  SESSION_COMPACTING: 'session.compacting',
} as const;

export type OpenCodeEventName = typeof OpenCodeEventNames[keyof typeof OpenCodeEventNames];

/**
 * OpenCode Event Compatibility Matrix
 *
 * Track which events are available in which OpenCode versions.
 * Useful for graceful degradation if OpenCode API changes.
 */
interface IEventInfo {
  readonly since: string;
  readonly stable: boolean;
  readonly description: string;
}

const EVENT_MATRIX: Record<OpenCodeEventName, IEventInfo> = {
  [OpenCodeEventNames.SESSION_CREATED]: {
    since: '0.1.0',
    stable: true,
    description: 'Fired when a new session is created',
  },
  [OpenCodeEventNames.SESSION_UPDATED]: {
    since: '0.1.0',
    stable: true,
    description: 'Fired when session state changes',
  },
  [OpenCodeEventNames.SESSION_DELETED]: {
    since: '0.1.0',
    stable: true,
    description: 'Fired when a session is deleted',
  },
  [OpenCodeEventNames.SESSION_IDLE]: {
    since: '1.0.0',
    stable: true,
    description: 'Fired when session becomes idle (no pending work)',
  },
  [OpenCodeEventNames.SESSION_COMPACTED]: {
    since: '1.0.0',
    stable: true,
    description: 'Fired after context compaction completes',
  },
  [OpenCodeEventNames.SESSION_ERROR]: {
    since: '1.0.0',
    stable: true,
    description: 'Fired when session encounters an error',
  },
  [OpenCodeEventNames.MESSAGE_UPDATED]: {
    since: '0.1.0',
    stable: true,
    description: 'Fired when a message is updated',
  },
  [OpenCodeEventNames.TOOL_EXECUTE_BEFORE]: {
    since: '0.1.0',
    stable: true,
    description: 'Fired before tool execution',
  },
  [OpenCodeEventNames.TOOL_EXECUTE_AFTER]: {
    since: '0.1.0',
    stable: true,
    description: 'Fired after tool execution completes',
  },
  [OpenCodeEventNames.SESSION_COMPACTING]: {
    since: '1.0.0',
    stable: true,
    description: 'Hook to inject context during compaction',
  },
};

/**
 * OpenCode Events utility object
 */
export const OpenCodeEvents = {
  /**
   * Check if an event is supported in a given OpenCode version.
   * @param event - Event name to check
   * @param _version - OpenCode version (future: semver comparison)
   */
  isSupported(event: OpenCodeEventName, _version?: string): boolean {
    const info = EVENT_MATRIX[event];
    if (!info) return false;
    // TODO: Add semver comparison if version provided
    return true;
  },

  /**
   * Get event info (version introduced, stability, description)
   */
  getEventInfo(event: OpenCodeEventName): IEventInfo | undefined {
    return EVENT_MATRIX[event];
  },

  /**
   * Check if event is marked as stable
   */
  isStable(event: OpenCodeEventName): boolean {
    return EVENT_MATRIX[event]?.stable ?? false;
  },

  /**
   * Get all stable events
   */
  getStableEvents(): OpenCodeEventName[] {
    return (Object.keys(EVENT_MATRIX) as OpenCodeEventName[]).filter(
      (event) => EVENT_MATRIX[event].stable
    );
  },
};

/**
 * Map Lisa session triggers to OpenCode events
 */
export const TriggerToOpenCodeEvent = {
  startup: OpenCodeEventNames.SESSION_CREATED,
  resume: OpenCodeEventNames.SESSION_UPDATED,
  compact: OpenCodeEventNames.SESSION_COMPACTED,
  clear: OpenCodeEventNames.SESSION_CREATED, // Clear is like a fresh start
} as const;

/**
 * Map OpenCode events to Lisa session triggers
 */
export const OpenCodeEventToTrigger = {
  [OpenCodeEventNames.SESSION_CREATED]: 'startup',
  [OpenCodeEventNames.SESSION_UPDATED]: 'resume',
  [OpenCodeEventNames.SESSION_COMPACTED]: 'compact',
  [OpenCodeEventNames.SESSION_COMPACTING]: 'compact',
} as const;
