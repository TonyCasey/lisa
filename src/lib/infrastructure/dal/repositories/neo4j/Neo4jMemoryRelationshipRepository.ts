/**
 * Neo4j Memory Relationship Repository
 *
 * Stores and queries typed relationships between memory facts using
 * Neo4j MEMORY_RELATION edges between Entity nodes.
 *
 * Data model:
 * - Facts are edges: (s:Entity)-[r]->(t:Entity) where r has uuid, group_id, fact, etc.
 * - Relationships connect target Entity nodes of two facts via MEMORY_RELATION edges.
 */

import type { IMemoryRelationship, MemoryRelationType } from '../../../../domain/interfaces/types/IMemoryRelationship';
import type {
  IMemoryRelationshipRepository,
  IRelationshipQueryOptions,
} from '../../../../domain/interfaces/dal/IMemoryRelationshipRepository';
import type { Neo4jConnectionManager } from '../../connections/Neo4jConnectionManager';

/**
 * Raw Neo4j record for relationship queries.
 */
interface Neo4jRelationRecord {
  sourceUuid: string;
  targetUuid: string;
  relationType: string;
  metadata: string | null;
  created_at: string | null;
}

/**
 * Neo4j Memory Relationship Repository implementation.
 */
export class Neo4jMemoryRelationshipRepository implements IMemoryRelationshipRepository {
  constructor(private readonly connection: Neo4jConnectionManager) {}

  /**
   * Create a relationship between two memory facts.
   */
  async createRelationship(
    groupId: string,
    relationship: Omit<IMemoryRelationship, 'createdAt'>
  ): Promise<void> {
    const { sourceUuid, targetUuid, relationType, metadata } = relationship;

    // Find the target Entity nodes of each fact edge and create MEMORY_RELATION between them
    const cypher = `
      MATCH (s1:Entity)-[sr]->(t1:Entity)
      WHERE sr.uuid = $sourceUuid AND sr.group_id IN $groupIds
      WITH t1, sr
      LIMIT 1
      MATCH (s2:Entity)-[tr]->(t2:Entity)
      WHERE tr.uuid = $targetUuid AND tr.group_id IN $groupIds
      WITH t1, t2, sr, tr
      LIMIT 1
      MERGE (t1)-[rel:MEMORY_RELATION {type: $relationType, source_uuid: $sourceUuid, target_uuid: $targetUuid, group_id: $groupId}]->(t2)
      SET rel.created_at = datetime(),
          rel.metadata = $metadata,
          rel.group_id = $groupId
    `;

    await this.connection.write(cypher, {
      sourceUuid,
      targetUuid,
      relationType,
      metadata: metadata ?? null,
      groupId,
      groupIds: [groupId],
    });
  }

  /**
   * Find relationships for a memory fact.
   */
  async findRelationships(
    groupId: string,
    uuid: string,
    options?: IRelationshipQueryOptions
  ): Promise<readonly IMemoryRelationship[]> {
    const direction = options?.direction ?? 'both';
    const relationType = options?.relationType;
    const results: IMemoryRelationship[] = [];

    if (direction === 'outgoing' || direction === 'both') {
      const outgoing = await this.queryOutgoing(groupId, uuid, relationType);
      results.push(...outgoing);
    }

    if (direction === 'incoming' || direction === 'both') {
      const incoming = await this.queryIncoming(groupId, uuid, relationType);
      results.push(...incoming);
    }

    return results;
  }

  /**
   * Remove a specific relationship between two facts.
   */
  async removeRelationship(
    groupId: string,
    sourceUuid: string,
    targetUuid: string,
    relationType: MemoryRelationType
  ): Promise<void> {
    const cypher = `
      MATCH (t1:Entity)-[rel:MEMORY_RELATION]->(t2:Entity)
      WHERE rel.source_uuid = $sourceUuid
        AND rel.target_uuid = $targetUuid
        AND rel.type = $relationType
        AND rel.group_id = $groupId
      DELETE rel
    `;

    await this.connection.write(cypher, {
      sourceUuid,
      targetUuid,
      relationType,
      groupId,
    });
  }

  /**
   * Query outgoing relationships (where the fact is the source).
   */
  private async queryOutgoing(
    groupId: string,
    uuid: string,
    relationType?: MemoryRelationType
  ): Promise<IMemoryRelationship[]> {
    const typeFilter = relationType ? 'AND rel.type = $relationType' : '';
    const cypher = `
      MATCH (t1:Entity)-[rel:MEMORY_RELATION]->(t2:Entity)
      WHERE rel.source_uuid = $uuid
        AND rel.group_id = $groupId
        ${typeFilter}
      RETURN rel.source_uuid AS sourceUuid,
             rel.target_uuid AS targetUuid,
             rel.type AS relationType,
             rel.metadata AS metadata,
             rel.created_at AS created_at
    `;

    const records = await this.connection.query<Neo4jRelationRecord>(cypher, {
      uuid,
      groupId,
      relationType: relationType ?? null,
    });

    return records.map(this.toRelationship);
  }

  /**
   * Query incoming relationships (where the fact is the target).
   */
  private async queryIncoming(
    groupId: string,
    uuid: string,
    relationType?: MemoryRelationType
  ): Promise<IMemoryRelationship[]> {
    const typeFilter = relationType ? 'AND rel.type = $relationType' : '';
    const cypher = `
      MATCH (t1:Entity)-[rel:MEMORY_RELATION]->(t2:Entity)
      WHERE rel.target_uuid = $uuid
        AND rel.group_id = $groupId
        ${typeFilter}
      RETURN rel.source_uuid AS sourceUuid,
             rel.target_uuid AS targetUuid,
             rel.type AS relationType,
             rel.metadata AS metadata,
             rel.created_at AS created_at
    `;

    const records = await this.connection.query<Neo4jRelationRecord>(cypher, {
      uuid,
      groupId,
      relationType: relationType ?? null,
    });

    return records.map(this.toRelationship);
  }

  /**
   * Convert a Neo4j record to an IMemoryRelationship.
   */
  private toRelationship(record: Neo4jRelationRecord): IMemoryRelationship {
    return {
      sourceUuid: record.sourceUuid,
      targetUuid: record.targetUuid,
      relationType: record.relationType as MemoryRelationType,
      metadata: record.metadata ?? undefined,
      createdAt: record.created_at ?? undefined,
    };
  }
}
