/**
 * GitHub Data Fetcher
 *
 * Wraps the GithubClient to fetch enriched PR data for heuristic extraction.
 * Provides a clean interface for fetching PR descriptions, review comments,
 * and linked issues in a format suitable for pattern matching.
 *
 * Part of LISA-9: Phase 3 Git-Powered Memory Extraction.
 */

import type {
  IGitHubDataFetcher,
  IEnrichedPR,
  IReviewComment,
  ILinkedIssue,
} from '../../domain/interfaces/IGitExtractor';
import type { ILogger } from '../../domain/interfaces/ILogger';
import type { GithubClient } from './GithubClient';
import { GithubClientError } from './types';

/**
 * Create a GitHub data fetcher.
 *
 * @param githubClient - The underlying GitHub client
 * @param logger - Optional logger
 * @returns A data fetcher for PR enrichment
 */
export function createGitHubDataFetcher(
  githubClient: GithubClient,
  logger?: ILogger
): IGitHubDataFetcher {
  return {
    async fetchPR(repo: string, prNumber: number): Promise<IEnrichedPR | null> {
      try {
        // Fetch PR details
        const pr = await githubClient.getPr(repo, prNumber);

        // Fetch review threads with resolution status
        let reviewComments: IReviewComment[] = [];
        try {
          const threads = await githubClient.getPrReviewThreads(repo, prNumber);
          reviewComments = threads.flatMap(thread =>
            thread.comments.nodes.map(comment => ({
              id: comment.databaseId,
              author: comment.author?.login ?? 'unknown',
              body: comment.body,
              path: comment.path,
              isResolved: thread.isResolved,
            }))
          );
        } catch (error) {
          // Log but continue - reviews are optional
          logger?.debug('Failed to fetch review threads', {
            repo,
            prNumber,
            error: (error as Error).message,
          });
        }

        // Fetch linked issues
        let linkedIssues: ILinkedIssue[] = [];
        if (pr.closingIssuesReferences && pr.closingIssuesReferences.length > 0) {
          linkedIssues = await Promise.all(
            pr.closingIssuesReferences.map(async (ref) => {
              try {
                const issue = await githubClient.getIssue(repo, ref.number);
                return {
                  number: issue.number,
                  title: issue.title,
                  body: issue.body || '',
                };
              } catch (error) {
                // Return minimal info if fetch fails
                logger?.debug('Failed to fetch linked issue', {
                  repo,
                  issueNumber: ref.number,
                  error: (error as Error).message,
                });
                return {
                  number: ref.number,
                  title: ref.title,
                  body: '',
                };
              }
            })
          );
        }

        return {
          number: pr.number,
          title: pr.title,
          body: pr.body || '',
          author: pr.author?.login ?? 'unknown',
          reviewComments,
          linkedIssues,
        };
      } catch (error) {
        if (error instanceof GithubClientError) {
          if (error.code === 'NOT_FOUND') {
            logger?.debug('PR not found', { repo, prNumber });
            return null;
          }
          if (error.code === 'NOT_AUTHENTICATED' || error.code === 'NOT_INSTALLED') {
            logger?.warn('GitHub not available', {
              repo,
              prNumber,
              code: error.code,
            });
            return null;
          }
        }

        logger?.warn('Failed to fetch PR', {
          repo,
          prNumber,
          error: (error as Error).message,
        });
        return null;
      }
    },

    async isAvailable(): Promise<boolean> {
      return githubClient.isAvailable();
    },
  };
}
