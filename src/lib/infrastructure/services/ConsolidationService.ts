/**
 * Consolidation Service Implementation.
 *
 * Consolidates duplicate or related memory facts by merging,
 * archiving duplicates, or keeping all unchanged.
 *
 * Creates supersedes relationships when a relationship writer is available.
 *
 * Part of Phase 5C: Curation & Compaction.
 */

import type {
  IConsolidationService,
  IConsolidationResult,
  IConsolidationOptions,
  ConsolidationAction,
} from '../../domain/interfaces/IConsolidationService';
import type { IMemoryWriter, IMemoryReader, IMemoryRelationshipWriter } from '../../domain/interfaces/IMemoryService';

/**
 * Create a ConsolidationService.
 *
 * @param memoryWriter - Memory writer for adding/expiring facts
 * @param memoryReader - Memory reader for loading facts (to find newest)
 * @param relationshipWriter - Optional relationship writer for supersedes links
 */
export function createConsolidationService(
  memoryWriter: IMemoryWriter,
  memoryReader: IMemoryReader,
  relationshipWriter?: IMemoryRelationshipWriter
): IConsolidationService {
  return {
    async consolidate(
      groupId: string,
      factUuids: readonly string[],
      action: ConsolidationAction,
      options?: IConsolidationOptions
    ): Promise<IConsolidationResult> {
      // Validate: at least 2 UUIDs
      if (factUuids.length < 2) {
        throw new Error('Consolidation requires at least 2 fact UUIDs');
      }

      // Validate: retainUuid must be in the list
      if (options?.retainUuid && !factUuids.includes(options.retainUuid)) {
        throw new Error(`retainUuid "${options.retainUuid}" is not in the provided fact UUIDs`);
      }

      if (action === 'keep-all') {
        return {
          action: 'keep-all',
          retainedUuid: factUuids[0],
          archivedUuids: [],
          relationshipsCreated: 0,
        };
      }

      if (action === 'merge') {
        return await handleMerge(groupId, factUuids, options);
      }

      // archive-duplicates
      return await handleArchiveDuplicates(groupId, factUuids, options);
    },
  };

  /**
   * Handle the merge action: create new fact, expire originals, link supersedes.
   */
  async function handleMerge(
    groupId: string,
    factUuids: readonly string[],
    options?: IConsolidationOptions
  ): Promise<IConsolidationResult> {
    // Determine merged text
    const mergedText = options?.mergedText;
    if (!mergedText) {
      throw new Error('merge action requires mergedText in options');
    }

    // Add the new merged fact
    await memoryWriter.addFact(groupId, mergedText);

    // Find the UUID of the newly created fact by loading recent facts
    // and matching the text. We load the most recent fact.
    const recentFacts = await memoryReader.loadFactsDateOrdered([groupId], 1);
    const newFact = recentFacts[0];
    const retainedUuid = newFact?.uuid ?? 'unknown';

    // Expire all original facts
    const archivedUuids: string[] = [];
    for (const uuid of factUuids) {
      await memoryWriter.expireFact(groupId, uuid);
      archivedUuids.push(uuid);
    }

    // Create supersedes relationships
    let relationshipsCreated = 0;
    if (relationshipWriter && retainedUuid !== 'unknown') {
      for (const uuid of factUuids) {
        try {
          await relationshipWriter.linkFacts(groupId, retainedUuid, uuid, 'supersedes');
          relationshipsCreated++;
        } catch {
          // Gracefully skip if relationship creation fails
        }
      }
    }

    return {
      action: 'merge',
      retainedUuid,
      archivedUuids,
      relationshipsCreated,
    };
  }

  /**
   * Handle the archive-duplicates action: keep one, expire rest, link supersedes.
   */
  async function handleArchiveDuplicates(
    groupId: string,
    factUuids: readonly string[],
    options?: IConsolidationOptions
  ): Promise<IConsolidationResult> {
    let retainUuid = options?.retainUuid;

    // Default to the newest fact if no retainUuid specified
    if (!retainUuid) {
      const facts = await memoryReader.loadFactsDateOrdered([groupId], factUuids.length + 10);
      // Find the newest fact that's in our UUID list
      const uuidSet = new Set(factUuids);
      const newest = facts.find((f) => f.uuid && uuidSet.has(f.uuid));
      retainUuid = newest?.uuid ?? factUuids[0];
    }

    // Expire all facts except the retained one
    const archivedUuids: string[] = [];
    for (const uuid of factUuids) {
      if (uuid !== retainUuid) {
        await memoryWriter.expireFact(groupId, uuid);
        archivedUuids.push(uuid);
      }
    }

    // Create supersedes relationships
    let relationshipsCreated = 0;
    if (relationshipWriter) {
      for (const uuid of archivedUuids) {
        try {
          await relationshipWriter.linkFacts(groupId, retainUuid, uuid, 'supersedes');
          relationshipsCreated++;
        } catch {
          // Gracefully skip if relationship creation fails
        }
      }
    }

    return {
      action: 'archive-duplicates',
      retainedUuid: retainUuid,
      archivedUuids,
      relationshipsCreated,
    };
  }
}
