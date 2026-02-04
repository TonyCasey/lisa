/**
 * Git Extractor Service
 *
 * Heuristic-based extraction of structured facts from GitHub PR data.
 * Fetches PR descriptions, review comments, and linked issues, then
 * applies pattern matching to extract decision, gotcha, and convention facts.
 *
 * Complements the LLM-based CommitEnricher with fast, no-cost extraction.
 *
 * Part of LISA-9: Phase 3 Git-Powered Memory Extraction.
 */

import type {
  IGitExtractor,
  IGitHubDataFetcher,
  IHeuristicExtractionResult,
  IHeuristicExtractionOptions,
  IHeuristicFact,
  HeuristicFactType,
  FactSource,
} from '../../domain/interfaces/IGitExtractor';
import type { ILogger } from '../../domain/interfaces/ILogger';
import type { ConfidenceLevel } from '../../domain/interfaces/types/IMemoryQuality';
import {
  extractPatternMatches,
  extractByFactType,
} from '../../infrastructure/services/patterns/HeuristicPatterns';

/** Default maximum PRs to process in one call. */
const DEFAULT_MAX_PRS = 10;

/**
 * Mutable version of IHeuristicFact for internal processing.
 * Allows modification before converting to readonly interface.
 */
interface IMutableHeuristicFact {
  text: string;
  type: HeuristicFactType;
  source: FactSource;
  confidence: ConfidenceLevel;
  tags: string[];
  prNumber?: number;
  issueNumber?: number;
  commitSha?: string;
  matchedPattern?: string;
}

/** Confidence level ordering for filtering. */
const CONFIDENCE_ORDER: Record<ConfidenceLevel, number> = {
  verified: 4,
  high: 3,
  medium: 2,
  low: 1,
  uncertain: 0,
};

/**
 * Create a Git extractor service.
 *
 * @param dataFetcher - GitHub data fetcher for PR/issue data
 * @param logger - Optional logger
 * @returns A Git extractor service
 */
export function createGitExtractorService(
  dataFetcher: IGitHubDataFetcher,
  logger?: ILogger
): IGitExtractor {
  return {
    async extractFromPRs(
      prNumbers: readonly number[],
      repo: string,
      options: IHeuristicExtractionOptions = {}
    ): Promise<IHeuristicExtractionResult> {
      const maxPRs = options.maxPRs ?? DEFAULT_MAX_PRS;
      const skipPRs = new Set(options.skipPRs ?? []);
      const extractTypes = options.extractTypes;
      const minConfidence = options.minConfidence ?? 'low';
      const minConfidenceLevel = CONFIDENCE_ORDER[minConfidence];

      // Filter and limit PRs to process
      const toProcess = prNumbers
        .filter(n => !skipPRs.has(n))
        .slice(0, maxPRs);

      if (toProcess.length === 0) {
        return {
          facts: [],
          prsProcessed: 0,
          prsSkipped: prNumbers.length,
          patternsMatched: 0,
        };
      }

      logger?.debug('Starting PR extraction', {
        repo,
        prCount: toProcess.length,
        extractTypes,
      });

      const allFacts: IMutableHeuristicFact[] = [];
      let prsProcessed = 0;
      let prsSkipped = prNumbers.length - toProcess.length;
      let patternsMatched = 0;

      // Process each PR
      for (const prNumber of toProcess) {
        try {
          const pr = await dataFetcher.fetchPR(repo, prNumber);

          if (!pr) {
            prsSkipped++;
            continue;
          }

          prsProcessed++;

          // Extract from PR description
          const descFacts = extractFromText(
            pr.body,
            'pr-description',
            prNumber,
            undefined,
            extractTypes
          );
          allFacts.push(...descFacts);
          patternsMatched += descFacts.length;

          // Extract from review comments
          for (const comment of pr.reviewComments) {
            const commentFacts = extractFromText(
              comment.body,
              'review-comment',
              prNumber,
              undefined,
              extractTypes
            );

            // Boost confidence for resolved review threads (indicates accepted feedback)
            if (comment.isResolved) {
              for (const fact of commentFacts) {
                if (fact.type === 'gotcha' || fact.type === 'convention') {
                  // Resolved feedback is more likely to be valuable
                  fact.confidence = boostConfidence(fact.confidence);
                }
              }
            }

            // Add file path as tag if available
            if (comment.path) {
              for (const fact of commentFacts) {
                fact.tags.push(comment.path);
              }
            }

            allFacts.push(...commentFacts);
            patternsMatched += commentFacts.length;
          }

          // Extract from linked issues
          for (const issue of pr.linkedIssues) {
            if (issue.body) {
              const issueFacts = extractFromText(
                issue.body,
                'issue-body',
                prNumber,
                issue.number,
                extractTypes
              );
              allFacts.push(...issueFacts);
              patternsMatched += issueFacts.length;
            }
          }

          logger?.debug('Extracted facts from PR', {
            prNumber,
            factCount: allFacts.length,
          });
        } catch (error) {
          logger?.warn('Failed to process PR', {
            repo,
            prNumber,
            error: (error as Error).message,
          });
          prsSkipped++;
        }
      }

      // Filter by minimum confidence
      const filteredFacts = allFacts.filter(
        f => CONFIDENCE_ORDER[f.confidence] >= minConfidenceLevel
      );

      // Deduplicate by similar text
      const uniqueFacts = deduplicateFacts(filteredFacts);

      logger?.info('PR extraction complete', {
        repo,
        prsProcessed,
        prsSkipped,
        patternsMatched,
        factsExtracted: uniqueFacts.length,
      });

      return {
        facts: uniqueFacts,
        prsProcessed,
        prsSkipped,
        patternsMatched,
      };
    },
  };
}

/**
 * Extract facts from text using heuristic patterns.
 */
function extractFromText(
  text: string,
  source: FactSource,
  prNumber: number,
  issueNumber?: number,
  filterTypes?: readonly HeuristicFactType[]
): IMutableHeuristicFact[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const matches = filterTypes
    ? filterTypes.flatMap(type => extractByFactType(text, type))
    : extractPatternMatches(text);

  return matches.map(match => ({
    text: cleanExtractedText(match.text),
    type: match.factType,
    source,
    confidence: match.confidence as ConfidenceLevel,
    tags: extractTags(match.text),
    prNumber,
    issueNumber,
    matchedPattern: match.patternName,
  }));
}

/**
 * Clean extracted text for storage.
 */
function cleanExtractedText(text: string): string {
  return text
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .replace(/^\s*[-*]\s*/, '')  // Remove leading bullet points
    .trim();
}

/**
 * Extract potential tags from text (file paths, technologies).
 */
function extractTags(text: string): string[] {
  const tags: string[] = [];

  // Extract file paths
  const pathPattern = /(?:^|\s)([\w/-]+\.[a-z]{1,4})(?:\s|$|[,:])/gi;
  let match;
  while ((match = pathPattern.exec(text)) !== null) {
    if (match[1] && !match[1].includes('://')) {
      tags.push(match[1]);
    }
  }

  // Extract technology names (common ones)
  const techPatterns = [
    /\b(typescript|javascript|react|node|graphql|rest)\b/gi,
    /\b(postgres|mongodb|redis|neo4j)\b/gi,
    /\b(docker|kubernetes|aws|gcp)\b/gi,
  ];

  for (const pattern of techPatterns) {
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) {
        tags.push(match[1].toLowerCase());
      }
    }
  }

  return [...new Set(tags)];  // Dedupe
}

/**
 * Boost confidence level by one step.
 */
function boostConfidence(confidence: ConfidenceLevel): ConfidenceLevel {
  switch (confidence) {
    case 'low':
      return 'medium';
    case 'medium':
      return 'high';
    default:
      return confidence;
  }
}

/**
 * Deduplicate facts by similar text.
 * Converts mutable facts to readonly interface.
 */
function deduplicateFacts(facts: IMutableHeuristicFact[]): IHeuristicFact[] {
  const seen = new Map<string, IMutableHeuristicFact>();

  for (const fact of facts) {
    // Normalize text for comparison
    const normalized = fact.text.toLowerCase().replace(/\s+/g, ' ').trim();

    // Check for exact or near-duplicate
    const existing = seen.get(normalized);
    if (existing) {
      // Keep the one with higher confidence
      if (CONFIDENCE_ORDER[fact.confidence] > CONFIDENCE_ORDER[existing.confidence]) {
        seen.set(normalized, fact);
      }
    } else {
      seen.set(normalized, fact);
    }
  }

  return Array.from(seen.values());
}
