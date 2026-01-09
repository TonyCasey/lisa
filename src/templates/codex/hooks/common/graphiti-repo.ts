export {}; // keep declarations scoped

const { rpcCall, withGroup, DEFAULT_GROUP_ID } = require('./mcp-client');
const { getUserName } = require('./user');
const { formatTable } = require('./table');

type MemoryFact = {
  created_at?: string;
  fact?: string;
  name?: string;
  uuid?: string;
  attributes?: { status?: string };
  tags?: string[];
};

type GraphitiNode = {
  uuid?: string;
  name?: string;
  fact?: string;
  summary?: string;
  attributes?: { status?: string };
  tags?: string[];
};

function toLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isSameLocalDate(isoString: string | null | undefined, dateKey: string) {
  if (!isoString) return false;
  const d = new Date(isoString);
  return toLocalDateKey(d) === dateKey;
}

class GraphitiRepository {
  groupId: string;

  constructor({ groupId = DEFAULT_GROUP_ID }: { groupId?: string } = {}) {
    this.groupId = groupId;
  }

  /**
   * Fetch work-context facts for a user on a given date (local date key).
   * Defaults to today's date and current user.
   */
  async getDailyWorkFacts({
    user = getUserName(),
    date = toLocalDateKey(new Date()),
    sessionId = null,
    maxFacts = 200,
    order = 'desc',
    includeRelated = true,
  }: {
    user?: string;
    date?: string;
    sessionId?: string | null;
    maxFacts?: number;
    order?: 'asc' | 'desc';
    includeRelated?: boolean;
  } = {}) {
    const query = `${user} is working on the repository`;
    const primary = await this.searchFacts({ query, date, sessionId, maxFacts, order });

    if (!includeRelated || primary.facts.length) {
      return { user, date, facts: primary.facts, sessionId: primary.sessionId };
    }

    // Broaden search to related activity if no work-context facts are present.
    const relatedQueries = [
      'repository', // general repo activity facts
      `${user.toLowerCase()}`, // user-specific facts
      'UX enhancements',
    ];
    const merged = new Map<string, MemoryFact>();
    for (const q of relatedQueries) {
      const res = await this.searchFacts({ query: q, date, sessionId: primary.sessionId || sessionId, maxFacts, order });
      res.facts.forEach((f: MemoryFact) => merged.set(f.uuid || `${f.name}-${f.fact}`, f));
      sessionId = res.sessionId || sessionId;
    }
    return { user, date, facts: Array.from(merged.values()), sessionId };
  }

  async searchFacts({
    query,
    date,
    sessionId = null,
    maxFacts = 200,
    order = 'desc',
  }: {
    query: string;
    date: string;
    sessionId?: string | null;
    maxFacts?: number;
    order?: 'asc' | 'desc';
  }) {
    const params = withGroup({ query, max_facts: maxFacts, order }, this.groupId);
    const [resp, sid] = await rpcCall('search_memory_facts', params, sessionId);
    const facts: MemoryFact[] = (resp?.facts as MemoryFact[]) || [];
    const filtered = facts.filter((f: MemoryFact) => isSameLocalDate(f.created_at, date));
    return { facts: filtered, sessionId: sid };
  }

  /**
   * Format a list of fact objects into a CLI table string.
   */
  static formatFactsTable(facts: MemoryFact[] = []) {
    const headers = ['Time', 'Repo', 'Fact'];
    const rows = facts.map((f) => [
      f.created_at ? new Date(f.created_at).toISOString().slice(11, 19) : '',
      deriveRepo(f) || '',
      f.fact || '',
    ]);
    if (!rows.length) return '';
    return formatTable({
      headers,
      rows,
      colAligns: ['left', 'left', 'left'],
      wordWrap: false,
    });
  }

  static formatTasksTable(nodes: GraphitiNode[] = []) {
    const headers = ['ID', 'Name', 'Status', 'Summary'];
    const rows = nodes.map((n, idx) => [
      idx + 1,
      n.name || n.fact || n.uuid,
      extractStatus(n),
      n.summary || n.fact || '',
    ]);
    if (!rows.length) return '';
    return formatTable({
      headers,
      rows,
      colAligns: ['right', 'left', 'left', 'left'],
      colWidths: [4, 26, 10, 80],
      wordWrap: false,
    });
  }
}

function deriveRepo(factObj: MemoryFact = {}) {
  const fact = factObj.fact || '';
  const slug = /[A-Za-z0-9_.-]+/;
  const stop = new Set(['the', 'a', 'work', 'for', 'target']);
  // e.g., "belongs to the repository 'survey-ingestion-engine'"
  const trailing = fact.match(new RegExp(`repository\\s+['"]?(${slug.source})['"]?`, 'i'));
  if (trailing && !stop.has(trailing[1].toLowerCase())) return trailing[1];
  // e.g., "survey-ingestion-engine repository work is on the main branch."
  const leading = fact.match(new RegExp(`\\b(${slug.source})\\s+repository\\b`, 'i'));
  if (leading && !stop.has(leading[1].toLowerCase())) return leading[1];
  const hardcoded = ['survey-ingestion-engine', 'lisa', 'survey'];
  const found = hardcoded.find((r) => fact.toLowerCase().includes(r));
  if (found) return found;
  return null;
}

function extractStatus(node: GraphitiNode = {}) {
  if (node.attributes && node.attributes.status) return node.attributes.status;
  const tags = node.tags || [];
  const statusTag = tags.find((t) => t.startsWith('status:'));
  return statusTag ? statusTag.replace('status:', '') : 'unknown';
}

module.exports = { GraphitiRepository };
