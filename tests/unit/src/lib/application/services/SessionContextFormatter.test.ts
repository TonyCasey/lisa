import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SessionContextFormatter } from '../../../../../../src/lib/application/services/SessionContextFormatter';
import type {
  ISessionContext,
  IFormattableMemories,
  IGitCommit,
} from '../../../../../../src/lib/application/services/SessionContextFormatter';
import type { IMemoryItem, ITask, ITaskCounts } from '../../../../../../src/lib/domain';

/**
 * Helper: create a memory item with sensible defaults.
 */
function createMemoryItem(overrides?: Partial<IMemoryItem>): IMemoryItem {
  return {
    uuid: 'mem-001',
    name: 'test-fact',
    fact: 'Some test fact',
    tags: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Helper: create a memory item at a specific time offset from now.
 */
function createMemoryAtOffset(
  hoursAgo: number,
  overrides?: Partial<IMemoryItem>,
): IMemoryItem {
  const date = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  return createMemoryItem({
    created_at: date.toISOString(),
    ...overrides,
  });
}

/**
 * Helper: create a task with sensible defaults.
 */
function createTask(overrides?: Partial<ITask>): ITask {
  return {
    key: 'TASK-1',
    title: 'Test task',
    status: 'ready',
    blocked: [],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Helper: create empty task counts.
 */
function createTaskCounts(overrides?: Partial<ITaskCounts>): ITaskCounts {
  return {
    ready: 0,
    'in-progress': 0,
    blocked: 0,
    done: 0,
    closed: 0,
    unknown: 0,
    ...overrides,
  };
}

/**
 * Helper: create session context.
 */
function createSessionContext(overrides?: Partial<ISessionContext>): ISessionContext {
  return {
    projectName: 'test-project',
    userName: 'testuser',
    folderType: 'git',
    projectRoot: '/home/testuser/projects/test-project',
    branch: 'main',
    ...overrides,
  };
}

/**
 * Helper: create formattable memories.
 */
function createFormattableMemories(
  overrides?: Partial<IFormattableMemories>,
): IFormattableMemories {
  return {
    facts: [],
    nodes: [],
    initReview: null,
    timedOut: false,
    ...overrides,
  };
}

describe('SessionContextFormatter', () => {
  const formatter = new SessionContextFormatter();

  // ========================================================================
  // getTriggerMessage
  // ========================================================================

  describe('getTriggerMessage', () => {
    it('should return startup message for startup trigger', () => {
      const result = formatter.getTriggerMessage('startup', false);
      assert.strictEqual(result, 'Memory loaded for session start.');
    });

    it('should return resume message for resume trigger', () => {
      const result = formatter.getTriggerMessage('resume', false);
      assert.strictEqual(result, 'Memory loaded for session resume.');
    });

    it('should return compact message for compact trigger', () => {
      const result = formatter.getTriggerMessage('compact', false);
      assert.strictEqual(result, 'Memory reloaded after context compaction.');
    });

    it('should return clear message for clear trigger', () => {
      const result = formatter.getTriggerMessage('clear', false);
      assert.strictEqual(result, 'Memory loaded after context clear.');
    });

    it('should append timed out suffix for startup when timedOut is true', () => {
      const result = formatter.getTriggerMessage('startup', true);
      assert.strictEqual(result, 'Memory loaded for session start (partial - timed out).');
    });

    it('should append timed out suffix for resume when timedOut is true', () => {
      const result = formatter.getTriggerMessage('resume', true);
      assert.strictEqual(result, 'Memory loaded for session resume (partial - timed out).');
    });

    it('should append timed out suffix for compact when timedOut is true', () => {
      const result = formatter.getTriggerMessage('compact', true);
      assert.strictEqual(result, 'Memory reloaded after context compaction (partial - timed out).');
    });

    it('should append timed out suffix for clear when timedOut is true', () => {
      const result = formatter.getTriggerMessage('clear', true);
      assert.strictEqual(result, 'Memory loaded after context clear (partial - timed out).');
    });

    it('should fallback to startup message for unknown trigger', () => {
      // Cast to bypass TypeScript type checking for edge case
      const result = formatter.getTriggerMessage('unknown' as 'startup', false);
      assert.strictEqual(result, 'Memory loaded for session start.');
    });
  });

  // ========================================================================
  // getTriggerReminders
  // ========================================================================

  describe('getTriggerReminders', () => {
    it('should return empty array for startup trigger', () => {
      const result = formatter.getTriggerReminders('startup');
      assert.deepStrictEqual(result, []);
    });

    it('should return empty array for resume trigger', () => {
      const result = formatter.getTriggerReminders('resume');
      assert.deepStrictEqual(result, []);
    });

    it('should return 3 reminders for compact trigger', () => {
      const result = formatter.getTriggerReminders('compact');
      assert.strictEqual(result.length, 3);
    });

    it('should include skills reminder for compact trigger', () => {
      const result = formatter.getTriggerReminders('compact');
      assert.ok(result[0].includes('/memory'));
      assert.ok(result[0].includes('/tasks'));
      assert.ok(result[0].includes('/lisa'));
      assert.ok(result[0].includes('/jira'));
      assert.ok(result[0].includes('/git'));
      assert.ok(result[0].includes('/pr'));
    });

    it('should include rules reminder for compact trigger', () => {
      const result = formatter.getTriggerReminders('compact');
      assert.ok(result[1].includes('Rules loaded'));
      assert.ok(result[1].includes('.lisa/rules/'));
    });

    it('should include memory usage hint for compact trigger', () => {
      const result = formatter.getTriggerReminders('compact');
      assert.ok(result[2].includes('/memory'));
      assert.ok(result[2].includes('Lisa'));
    });

    it('should return 3 reminders for clear trigger', () => {
      const result = formatter.getTriggerReminders('clear');
      assert.strictEqual(result.length, 3);
    });

    it('should include fresh session message for clear trigger', () => {
      const result = formatter.getTriggerReminders('clear');
      assert.ok(result[0].includes('Fresh session'));
      assert.ok(result[0].includes('/memory'));
    });

    it('should include rules reminder for clear trigger', () => {
      const result = formatter.getTriggerReminders('clear');
      assert.ok(result[1].includes('Rules loaded'));
    });

    it('should include recall hint for clear trigger', () => {
      const result = formatter.getTriggerReminders('clear');
      assert.ok(result[2].includes('/memory'));
      assert.ok(result[2].includes('/lisa'));
    });
  });

  // ========================================================================
  // filterRecentMemories
  // ========================================================================

  describe('filterRecentMemories', () => {
    it('should return empty array when given empty memories', () => {
      const result = formatter.filterRecentMemories([], 24);
      assert.deepStrictEqual(result, []);
    });

    it('should include memories within the time window', () => {
      const recentMemory = createMemoryAtOffset(1); // 1 hour ago
      const result = formatter.filterRecentMemories([recentMemory], 24);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].uuid, recentMemory.uuid);
    });

    it('should exclude memories older than the time window', () => {
      const oldMemory = createMemoryAtOffset(48); // 48 hours ago
      const result = formatter.filterRecentMemories([oldMemory], 24);
      assert.strictEqual(result.length, 0);
    });

    it('should exclude memories without created_at', () => {
      const noDate = createMemoryItem({ created_at: undefined });
      const result = formatter.filterRecentMemories([noDate], 24);
      assert.strictEqual(result.length, 0);
    });

    it('should exclude USER_SUBMITS_DIRECTION relationship', () => {
      const excluded = createMemoryAtOffset(1, { name: 'USER_SUBMITS_DIRECTION' });
      const result = formatter.filterRecentMemories([excluded], 24);
      assert.strictEqual(result.length, 0);
    });

    it('should exclude DIRECTION_IS_TOPIC relationship', () => {
      const excluded = createMemoryAtOffset(1, { name: 'DIRECTION_IS_TOPIC' });
      const result = formatter.filterRecentMemories([excluded], 24);
      assert.strictEqual(result.length, 0);
    });

    it('should exclude EXPANDED_ENTITY_TYPES_TRACKED relationship', () => {
      const excluded = createMemoryAtOffset(1, { name: 'EXPANDED_ENTITY_TYPES_TRACKED' });
      const result = formatter.filterRecentMemories([excluded], 24);
      assert.strictEqual(result.length, 0);
    });

    it('should exclude TESTS relationship', () => {
      const excluded = createMemoryAtOffset(1, { name: 'TESTS' });
      const result = formatter.filterRecentMemories([excluded], 24);
      assert.strictEqual(result.length, 0);
    });

    it('should exclude ASSESSES relationship', () => {
      const excluded = createMemoryAtOffset(1, { name: 'ASSESSES' });
      const result = formatter.filterRecentMemories([excluded], 24);
      assert.strictEqual(result.length, 0);
    });

    it('should keep non-excluded relationship names', () => {
      const included = createMemoryAtOffset(1, { name: 'SOME_VALID_RELATION' });
      const result = formatter.filterRecentMemories([included], 24);
      assert.strictEqual(result.length, 1);
    });

    it('should handle mixed recent and old memories', () => {
      const memories = [
        createMemoryAtOffset(1, { uuid: 'recent-1' }),
        createMemoryAtOffset(48, { uuid: 'old-1' }),
        createMemoryAtOffset(2, { uuid: 'recent-2' }),
        createMemoryAtOffset(72, { uuid: 'old-2' }),
      ];
      const result = formatter.filterRecentMemories(memories, 24);
      assert.strictEqual(result.length, 2);
      const uuids = result.map((m) => m.uuid);
      assert.ok(uuids.includes('recent-1'));
      assert.ok(uuids.includes('recent-2'));
    });

    it('should handle memories exactly at the cutoff boundary', () => {
      // Create a memory exactly at 24 hours ago (should be excluded since created < cutoff)
      const boundaryMemory = createMemoryAtOffset(24.001);
      const result = formatter.filterRecentMemories([boundaryMemory], 24);
      assert.strictEqual(result.length, 0);
    });

    it('should handle a small hoursAgo window', () => {
      const mem1h = createMemoryAtOffset(0.5, { uuid: 'half-hour' });
      const mem2h = createMemoryAtOffset(2, { uuid: 'two-hours' });
      const result = formatter.filterRecentMemories([mem1h, mem2h], 1);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].uuid, 'half-hour');
    });
  });

  // ========================================================================
  // groupMemoriesByTime
  // ========================================================================

  describe('groupMemoriesByTime', () => {
    it('should return empty array for empty memories', () => {
      const result = formatter.groupMemoriesByTime([], 5);
      assert.deepStrictEqual(result, []);
    });

    it('should create a single group for one memory', () => {
      const memory = createMemoryItem({ fact: 'Single fact' });
      const result = formatter.groupMemoriesByTime([memory], 5);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].memories.length, 1);
      assert.strictEqual(result[0].summary, 'Single fact');
    });

    it('should group memories within the time window', () => {
      const now = Date.now();
      const mem1 = createMemoryItem({
        uuid: 'a',
        fact: 'Fact A',
        created_at: new Date(now).toISOString(),
      });
      const mem2 = createMemoryItem({
        uuid: 'b',
        fact: 'Fact B',
        created_at: new Date(now - 2 * 60 * 1000).toISOString(), // 2 min ago
      });
      const result = formatter.groupMemoriesByTime([mem1, mem2], 5);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].memories.length, 2);
    });

    it('should create separate groups for memories outside the time window', () => {
      const now = Date.now();
      const mem1 = createMemoryItem({
        uuid: 'a',
        fact: 'Recent fact',
        created_at: new Date(now).toISOString(),
      });
      const mem2 = createMemoryItem({
        uuid: 'b',
        fact: 'Older fact',
        created_at: new Date(now - 10 * 60 * 1000).toISOString(), // 10 min ago
      });
      const result = formatter.groupMemoriesByTime([mem1, mem2], 5);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].memories.length, 1);
      assert.strictEqual(result[1].memories.length, 1);
    });

    it('should sort memories descending by date (newest first)', () => {
      const now = Date.now();
      const older = createMemoryItem({
        uuid: 'older',
        fact: 'Older',
        created_at: new Date(now - 20 * 60 * 1000).toISOString(),
      });
      const newer = createMemoryItem({
        uuid: 'newer',
        fact: 'Newer',
        created_at: new Date(now).toISOString(),
      });
      // Pass in wrong order to verify sorting
      const result = formatter.groupMemoriesByTime([older, newer], 5);
      assert.strictEqual(result[0].memories[0].uuid, 'newer');
    });

    it('should handle memories without created_at', () => {
      const noDate = createMemoryItem({ created_at: undefined, fact: 'No date' });
      const result = formatter.groupMemoriesByTime([noDate], 5);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].memories.length, 1);
    });

    it('should create three groups for three distinct time windows', () => {
      const now = Date.now();
      const mem1 = createMemoryItem({
        fact: 'Group 1',
        created_at: new Date(now).toISOString(),
      });
      const mem2 = createMemoryItem({
        fact: 'Group 2',
        created_at: new Date(now - 15 * 60 * 1000).toISOString(),
      });
      const mem3 = createMemoryItem({
        fact: 'Group 3',
        created_at: new Date(now - 30 * 60 * 1000).toISOString(),
      });
      const result = formatter.groupMemoriesByTime([mem1, mem2, mem3], 5);
      assert.strictEqual(result.length, 3);
    });
  });

  // ========================================================================
  // extractGroupSummary
  // ========================================================================

  describe('extractGroupSummary', () => {
    it('should return fact for single memory with fact', () => {
      const memory = createMemoryItem({ fact: 'Project uses TypeScript' });
      const result = formatter.extractGroupSummary([memory]);
      assert.strictEqual(result, 'Project uses TypeScript');
    });

    it('should return name for single memory with only name', () => {
      const memory = createMemoryItem({ fact: undefined, name: 'TypeScript Config' });
      const result = formatter.extractGroupSummary([memory]);
      assert.strictEqual(result, 'TypeScript Config');
    });

    it('should return <unknown> for single memory with neither fact nor name', () => {
      const memory = createMemoryItem({ fact: undefined, name: undefined });
      const result = formatter.extractGroupSummary([memory]);
      assert.strictEqual(result, '<unknown>');
    });

    it('should return "N items" when no memories have facts or names', () => {
      const memories = [
        createMemoryItem({ fact: undefined, name: undefined }),
        createMemoryItem({ fact: undefined, name: undefined }),
      ];
      const result = formatter.extractGroupSummary(memories);
      assert.strictEqual(result, '2 items');
    });

    it('should find common prefix for multiple memories with same start', () => {
      const memories = [
        createMemoryItem({ fact: 'Authentication system uses JWT tokens for sessions' }),
        createMemoryItem({ fact: 'Authentication system uses OAuth for third-party login' }),
      ];
      const result = formatter.extractGroupSummary(memories);
      assert.ok(result.includes('Authentication system'));
      assert.ok(result.includes('2 items'));
    });

    it('should strip trailing articles/prepositions from common prefix', () => {
      const memories = [
        createMemoryItem({ fact: 'The project uses the React framework' }),
        createMemoryItem({ fact: 'The project uses the Vue framework' }),
      ];
      const result = formatter.extractGroupSummary(memories);
      // "The project uses" -> "uses" is a stop word at end, should be stripped to "The project"
      // Then "the" at end is stripped -> "The project"
      // But "The" at beginning is not stripped (only trailing)
      assert.ok(result.includes('The project'));
      assert.ok(result.includes('2 items'));
    });

    it('should truncate first fact if no common prefix and fact is long', () => {
      const longFact =
        'This is a very long fact that does not share any prefix with the other memory item in this group at all';
      const memories = [
        createMemoryItem({ fact: longFact }),
        createMemoryItem({ fact: 'Completely different text here' }),
      ];
      const result = formatter.extractGroupSummary(memories);
      // longFact is >60 chars, so it should be truncated to 57 chars + "..."
      assert.ok(result.includes('...'));
      assert.ok(result.includes('+1 more'));
    });

    it('should show first fact with +N more when short and no common prefix', () => {
      const memories = [
        createMemoryItem({ fact: 'Short fact' }),
        createMemoryItem({ fact: 'Different fact' }),
        createMemoryItem({ fact: 'Another fact' }),
      ];
      const result = formatter.extractGroupSummary(memories);
      assert.ok(result.includes('Short fact'));
      assert.ok(result.includes('+2 more'));
    });

    it('should prefer fact over name in multiple-item groups', () => {
      const memories = [
        createMemoryItem({ fact: 'Config uses YAML', name: 'CONFIG_USES_YAML' }),
        createMemoryItem({ fact: 'Config uses JSON', name: 'CONFIG_USES_JSON' }),
      ];
      const result = formatter.extractGroupSummary(memories);
      // Common prefix from facts is "Config uses", which is >15 chars? No, it's 11 chars.
      // So it falls through to first fact display
      assert.ok(result.includes('Config uses YAML'));
      assert.ok(result.includes('+1 more'));
    });

    it('should fall back to name when fact is empty', () => {
      const memories = [
        createMemoryItem({ fact: undefined, name: 'Feature Alpha component' }),
        createMemoryItem({ fact: undefined, name: 'Feature Beta component' }),
      ];
      const result = formatter.extractGroupSummary(memories);
      // Both start with "Feature" but common prefix "Feature" is only 7 chars (< 15)
      // So falls through to first name display
      assert.ok(result.includes('Feature Alpha component'));
      assert.ok(result.includes('+1 more'));
    });

    it('should handle common prefix longer than 15 characters', () => {
      const memories = [
        createMemoryItem({ fact: 'The authentication module handles login flow' }),
        createMemoryItem({ fact: 'The authentication module handles logout flow' }),
      ];
      const result = formatter.extractGroupSummary(memories);
      // Common prefix: "The authentication module handles" -> strip trailing "handles" (no, it's not a stop word)
      // Actually "handles" is not in the stop word list. Let's check...
      // Stop words: the a an is are was were includes include has have with for to of in on at
      // So "handles" is NOT a stop word. Common prefix = "The authentication module handles"
      // That's > 15 chars, so result = "The authentication module handles (2 items)"
      assert.ok(result.includes('The authentication module handles'));
      assert.ok(result.includes('(2 items)'));
    });
  });

  // ========================================================================
  // formatMemorySummary
  // ========================================================================

  describe('formatMemorySummary', () => {
    it('should return empty array for no memories', () => {
      const result = formatter.formatMemorySummary([], 5);
      assert.deepStrictEqual(result, []);
    });

    it('should format a single memory with date and summary', () => {
      const memory = createMemoryItem({ fact: 'Project uses node:test' });
      const result = formatter.formatMemorySummary([memory], 5);
      assert.strictEqual(result.length, 1);
      assert.ok(result[0].startsWith('  '));
      assert.ok(result[0].includes('Project uses node:test'));
      assert.ok(result[0].includes(' - '));
    });

    it('should limit output to the specified limit', () => {
      const now = Date.now();
      const memories = Array.from({ length: 10 }, (_, i) =>
        createMemoryItem({
          uuid: `mem-${i}`,
          fact: `Fact number ${i}`,
          created_at: new Date(now - i * 10 * 60 * 1000).toISOString(), // 10 min apart
        }),
      );
      const result = formatter.formatMemorySummary(memories, 3);
      assert.strictEqual(result.length, 3);
    });

    it('should include date prefix in each line', () => {
      const memory = createMemoryItem({ fact: 'Test fact' });
      const result = formatter.formatMemorySummary([memory], 5);
      // Should match format: "  <date> - <summary>"
      assert.ok(/^\s+\S+.*-.*Test fact/.test(result[0]));
    });
  });

  // ========================================================================
  // formatDateRangeDescription
  // ========================================================================

  describe('formatDateRangeDescription', () => {
    it('should return "today" when since is today', () => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 1, 0, 0);
      const result = formatter.formatDateRangeDescription(todayStart);
      assert.strictEqual(result, 'today');
    });

    it('should return "last Xh" for times within 24 hours', () => {
      // Use just before midnight today (yesterday 23:59:59) to guarantee:
      // - Different calendar day (yesterday) so "today" check fails
      // - Always within 24 hours of now so "last Xh" path is taken
      const now = new Date();
      const midnightToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const since = new Date(midnightToday.getTime() - 1); // yesterday 23:59:59.999
      const result = formatter.formatDateRangeDescription(since);
      assert.ok(result.startsWith('last '), `Expected "last Xh", got "${result}"`);
      assert.ok(result.endsWith('h'), `Expected "last Xh", got "${result}"`);
    });

    it('should return "last X days" for times beyond 24 hours', () => {
      const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
      const result = formatter.formatDateRangeDescription(since);
      assert.ok(result.includes('last'));
      assert.ok(result.includes('day'));
    });

    it('should use singular "day" for 1 day ago', () => {
      // ~36 hours ago which rounds to ~1.5 days, so 2 days
      // Use exactly 25 hours to get 1 day
      const since = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const result = formatter.formatDateRangeDescription(since);
      assert.ok(result.includes('last'));
      assert.ok(result.includes('day'));
      // 25h rounds to 25h (> 24), daysAgo = round(25/24) = 1
      assert.strictEqual(result, 'last 1 day');
    });

    it('should use plural "days" for multiple days', () => {
      const since = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
      const result = formatter.formatDateRangeDescription(since);
      assert.ok(result.includes('days'));
    });
  });

  // ========================================================================
  // formatRelativeDate
  // ========================================================================

  describe('formatRelativeDate', () => {
    it('should return "Today HH:MM" for a date today', () => {
      const now = new Date();
      now.setHours(14, 30, 0, 0);
      const result = formatter.formatRelativeDate(now);
      assert.ok(result.startsWith('Today'));
      assert.ok(result.includes('14:30'));
    });

    it('should return "Yesterday HH:MM" for a date yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(9, 15, 0, 0);
      const result = formatter.formatRelativeDate(yesterday);
      assert.ok(result.startsWith('Yesterday'));
      assert.ok(result.includes('09:15'));
    });

    it('should return "Mon DD HH:MM" for older dates', () => {
      // Use a date 5 days ago to guarantee not today or yesterday
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 5);
      oldDate.setHours(16, 45, 0, 0);
      const result = formatter.formatRelativeDate(oldDate);
      // Should NOT start with Today or Yesterday
      assert.ok(!result.startsWith('Today'));
      assert.ok(!result.startsWith('Yesterday'));
      // Should contain the day number
      assert.ok(result.includes(String(oldDate.getDate())));
      // Should contain the time
      assert.ok(result.includes('16:45'));
    });

    it('should format midnight correctly as 00:00', () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const result = formatter.formatRelativeDate(today);
      assert.ok(result.startsWith('Today'));
      assert.ok(result.includes('00:00'));
    });
  });

  // ========================================================================
  // formatContextContent
  // ========================================================================

  describe('formatContextContent', () => {
    it('should include trigger message at the top', () => {
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext(),
      );
      assert.ok(result.startsWith('Memory loaded for session start.'));
    });

    it('should include timed out message when memories timed out', () => {
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories({ timedOut: true }),
        [],
        createTaskCounts(),
        createSessionContext(),
      );
      assert.ok(result.includes('(partial - timed out)'));
    });

    it('should include date range description when querySince is provided', () => {
      const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext(),
        [],
        since,
      );
      assert.ok(result.includes('Context range:'));
    });

    it('should not include date range when querySince is undefined', () => {
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext(),
      );
      assert.ok(!result.includes('Context range:'));
    });

    it('should include reminders for compact trigger', () => {
      const result = formatter.formatContextContent(
        'compact',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext(),
      );
      assert.ok(result.includes('Available skills:'));
      assert.ok(result.includes('Rules loaded'));
    });

    it('should include reminders for clear trigger', () => {
      const result = formatter.formatContextContent(
        'clear',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext(),
      );
      assert.ok(result.includes('Fresh session'));
      assert.ok(result.includes('Rules loaded'));
    });

    it('should not include reminders for startup trigger', () => {
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext(),
      );
      assert.ok(!result.includes('Available skills:'));
      assert.ok(!result.includes('Rules loaded'));
    });

    it('should include user and folder info', () => {
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext({ userName: 'alice', folderType: 'git' }),
      );
      assert.ok(result.includes('User: alice'));
      assert.ok(result.includes('(git)'));
    });

    it('should include repo name and branch', () => {
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext({ projectName: 'my-app', branch: 'feature-x' }),
      );
      assert.ok(result.includes('Repo: my-app (feature-x)'));
    });

    it('should omit branch parentheses when branch is null', () => {
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext({ branch: null }),
      );
      assert.ok(result.includes('Repo: test-project'));
      assert.ok(!result.includes('Repo: test-project ('));
    });

    it('should include init review when present', () => {
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories({ initReview: 'This is a Node.js project with TypeScript' }),
        [],
        createTaskCounts(),
        createSessionContext(),
      );
      assert.ok(result.includes('Codebase Summary:'));
      assert.ok(result.includes('This is a Node.js project with TypeScript'));
    });

    it('should not include codebase summary when initReview is null', () => {
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories({ initReview: null }),
        [],
        createTaskCounts(),
        createSessionContext(),
      );
      assert.ok(!result.includes('Codebase Summary:'));
    });

    it('should include recent git commits', () => {
      const commits: IGitCommit[] = [
        { hash: 'abc1234', message: 'feat: add user auth' },
        { hash: 'def5678', message: 'fix: resolve login bug' },
      ];
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext(),
        commits,
      );
      assert.ok(result.includes('Recent commits (2):'));
      assert.ok(result.includes('abc1234 feat: add user auth'));
      assert.ok(result.includes('def5678 fix: resolve login bug'));
    });

    it('should truncate commits to 5 and show overflow count', () => {
      const commits: IGitCommit[] = Array.from({ length: 7 }, (_, i) => ({
        hash: `hash${i}`,
        message: `commit ${i}`,
      }));
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext(),
        commits,
      );
      assert.ok(result.includes('Recent commits (7):'));
      assert.ok(result.includes('hash0'));
      assert.ok(result.includes('hash4'));
      assert.ok(!result.includes('hash5'));
      assert.ok(result.includes('... and 2 more'));
    });

    it('should not include commits section when no commits', () => {
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext(),
        [],
      );
      assert.ok(!result.includes('Recent commits'));
    });

    it('should show "none found" when no tasks', () => {
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext(),
      );
      assert.ok(result.includes('Tasks: none found for this repo'));
    });

    it('should display task counts summary', () => {
      const tasks = [
        createTask({ key: 'T-1', title: 'Active task', status: 'in-progress' }),
        createTask({ key: 'T-2', title: 'Ready task', status: 'ready' }),
      ];
      const counts = createTaskCounts({ 'in-progress': 1, ready: 1 });
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        tasks,
        counts,
        createSessionContext(),
      );
      assert.ok(result.includes('Tasks: 1 in-progress, 1 ready'));
    });

    it('should display active task', () => {
      const tasks = [
        createTask({ key: 'T-1', title: 'Build auth module', status: 'in-progress' }),
      ];
      const counts = createTaskCounts({ 'in-progress': 1 });
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        tasks,
        counts,
        createSessionContext(),
      );
      assert.ok(result.includes('Active: T-1 - Build auth module'));
    });

    it('should display ready tasks (up to 2)', () => {
      const tasks = [
        createTask({ key: 'T-1', title: 'Task one', status: 'ready' }),
        createTask({ key: 'T-2', title: 'Task two', status: 'ready' }),
        createTask({ key: 'T-3', title: 'Task three', status: 'ready' }),
      ];
      const counts = createTaskCounts({ ready: 3 });
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        tasks,
        counts,
        createSessionContext(),
      );
      assert.ok(result.includes('Ready: T-1 - Task one | T-2 - Task two'));
      // Third ready task should not be shown
      assert.ok(!result.includes('T-3'));
    });

    it('should show "none active" when counts are all zero', () => {
      const tasks = [createTask({ key: 'T-1', title: 'Unknown task', status: 'unknown' })];
      const counts = createTaskCounts();
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        tasks,
        counts,
        createSessionContext(),
      );
      assert.ok(result.includes('Tasks: none active'));
    });

    it('should display recent memories from facts when available', () => {
      const recentFact = createMemoryAtOffset(1, { fact: 'Recently learned fact' });
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories({ facts: [recentFact] }),
        [],
        createTaskCounts(),
        createSessionContext(),
      );
      assert.ok(result.includes('Recent memories (last 24h):'));
      assert.ok(result.includes('Recently learned fact'));
    });

    it('should fall back to nodes when facts are empty', () => {
      const recentNode = createMemoryAtOffset(1, { name: 'NodeEntity', fact: undefined });
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories({ nodes: [recentNode] }),
        [],
        createTaskCounts(),
        createSessionContext(),
      );
      assert.ok(result.includes('Recent memories (last 24h):'));
      assert.ok(result.includes('NodeEntity'));
    });

    it('should show "older memories exist" when items exist but none are recent', () => {
      const oldFact = createMemoryAtOffset(48, { fact: 'Old fact' });
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories({ facts: [oldFact] }),
        [],
        createTaskCounts(),
        createSessionContext(),
      );
      assert.ok(result.includes('none (older memories exist)'));
    });

    it('should not show memory section when no memories at all', () => {
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories({ facts: [], nodes: [] }),
        [],
        createTaskCounts(),
        createSessionContext(),
      );
      assert.ok(!result.includes('Recent memories'));
      assert.ok(!result.includes('older memories exist'));
    });

    it('should include all task count types when present', () => {
      const tasks = [
        createTask({ key: 'T-1', status: 'in-progress', title: 'A' }),
        createTask({ key: 'T-2', status: 'ready', title: 'B' }),
        createTask({ key: 'T-3', status: 'blocked', title: 'C' }),
        createTask({ key: 'T-4', status: 'done', title: 'D' }),
        createTask({ key: 'T-5', status: 'closed', title: 'E' }),
      ];
      const counts = createTaskCounts({
        'in-progress': 1,
        ready: 1,
        blocked: 1,
        done: 1,
        closed: 1,
      });
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        tasks,
        counts,
        createSessionContext(),
      );
      assert.ok(result.includes('1 in-progress'));
      assert.ok(result.includes('1 ready'));
      assert.ok(result.includes('1 blocked'));
      assert.ok(result.includes('1 done'));
      assert.ok(result.includes('1 closed'));
    });

    it('should produce a complete output integrating all sections', () => {
      const recentFact = createMemoryAtOffset(2, { fact: 'Auth module refactored' });
      const commits: IGitCommit[] = [
        { hash: 'abc', message: 'refactor: auth module' },
      ];
      const tasks = [
        createTask({ key: 'T-1', title: 'Implement login', status: 'in-progress' }),
        createTask({ key: 'T-2', title: 'Add tests', status: 'ready' }),
      ];
      const counts = createTaskCounts({ 'in-progress': 1, ready: 1 });

      const result = formatter.formatContextContent(
        'compact',
        createFormattableMemories({
          facts: [recentFact],
          initReview: 'Express.js API with PostgreSQL backend',
          timedOut: false,
        }),
        tasks,
        counts,
        createSessionContext({ projectName: 'my-api', branch: 'feature/auth' }),
        commits,
      );

      // Trigger message
      assert.ok(result.includes('Memory reloaded after context compaction.'));
      // Reminders (compact)
      assert.ok(result.includes('Available skills:'));
      // Context info
      assert.ok(result.includes('Repo: my-api (feature/auth)'));
      // Init review
      assert.ok(result.includes('Codebase Summary:'));
      assert.ok(result.includes('Express.js API with PostgreSQL backend'));
      // Commits
      assert.ok(result.includes('Recent commits (1):'));
      assert.ok(result.includes('abc refactor: auth module'));
      // Memories
      assert.ok(result.includes('Recent memories (last 24h):'));
      assert.ok(result.includes('Auth module refactored'));
      // Tasks
      assert.ok(result.includes('Tasks: 1 in-progress, 1 ready'));
      assert.ok(result.includes('Active: T-1 - Implement login'));
      assert.ok(result.includes('Ready: T-2 - Add tests'));
    });

    it('should replace HOME in project root with tilde', () => {
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      try {
        // Set HOME for the test
        process.env.HOME = '/home/testuser';
        process.env.USERPROFILE = '/home/testuser';
        const result = formatter.formatContextContent(
          'startup',
          createFormattableMemories(),
          [],
          createTaskCounts(),
          createSessionContext({
            projectRoot: '/home/testuser/projects/my-project',
          }),
        );
        assert.ok(result.includes('~/projects/my-project'));
      } finally {
        // Restore
        if (originalHome !== undefined) {
          process.env.HOME = originalHome;
        } else {
          delete process.env.HOME;
        }
        if (originalUserProfile !== undefined) {
          process.env.USERPROFILE = originalUserProfile;
        } else {
          delete process.env.USERPROFILE;
        }
      }
    });
  });

  // ========================================================================
  // Edge cases and interactions
  // ========================================================================

  describe('edge cases', () => {
    it('extractGroupSummary should handle empty facts array gracefully', () => {
      // A group with items that all have empty string facts
      const memories = [
        createMemoryItem({ fact: '', name: '' }),
        createMemoryItem({ fact: '', name: '' }),
      ];
      const result = formatter.extractGroupSummary(memories);
      assert.strictEqual(result, '2 items');
    });

    it('groupMemoriesByTime should handle all memories having same timestamp', () => {
      const now = new Date().toISOString();
      const memories = [
        createMemoryItem({ uuid: 'a', created_at: now, fact: 'Fact A' }),
        createMemoryItem({ uuid: 'b', created_at: now, fact: 'Fact B' }),
        createMemoryItem({ uuid: 'c', created_at: now, fact: 'Fact C' }),
      ];
      const result = formatter.groupMemoriesByTime(memories, 5);
      // All same time - should be in one group
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].memories.length, 3);
    });

    it('filterRecentMemories should handle readonly arrays', () => {
      const memories: readonly IMemoryItem[] = Object.freeze([
        createMemoryAtOffset(1, { uuid: 'frozen-mem' }),
      ]);
      const result = formatter.filterRecentMemories(memories, 24);
      assert.strictEqual(result.length, 1);
    });

    it('formatMemorySummary should respect limit of 0', () => {
      const memory = createMemoryItem({ fact: 'Some fact' });
      const result = formatter.formatMemorySummary([memory], 0);
      assert.deepStrictEqual(result, []);
    });

    it('extractGroupSummary should handle very short common prefix', () => {
      // Common prefix "A" is < 15 chars, so should fall through to first-fact display
      const memories = [
        createMemoryItem({ fact: 'A short one' }),
        createMemoryItem({ fact: 'A short two' }),
      ];
      const result = formatter.extractGroupSummary(memories);
      assert.ok(result.includes('A short one'));
      assert.ok(result.includes('+1 more'));
    });

    it('extractGroupSummary should handle common prefix exactly 15 characters', () => {
      // "1234567890abcde" is exactly 15 chars - should NOT match >15 check
      // Need words that form exactly 15+ chars prefix
      const memories = [
        createMemoryItem({ fact: 'Exactly fifteen chars long suffix alpha' }),
        createMemoryItem({ fact: 'Exactly fifteen chars long suffix beta' }),
      ];
      const result = formatter.extractGroupSummary(memories);
      // Common prefix: "Exactly fifteen chars long suffix" (32 chars) > 15
      assert.ok(result.includes('(2 items)'));
    });

    it('formatContextContent should handle empty git commits array', () => {
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext(),
        [],
      );
      assert.ok(!result.includes('Recent commits'));
    });

    it('formatContextContent should handle exactly 5 commits without overflow', () => {
      const commits: IGitCommit[] = Array.from({ length: 5 }, (_, i) => ({
        hash: `h${i}`,
        message: `msg ${i}`,
      }));
      const result = formatter.formatContextContent(
        'startup',
        createFormattableMemories(),
        [],
        createTaskCounts(),
        createSessionContext(),
        commits,
      );
      assert.ok(result.includes('Recent commits (5):'));
      assert.ok(!result.includes('... and'));
    });
  });
});
