/**
 * GitHub infrastructure module.
 *
 * Provides GitHub CLI wrapper and types for PR operations.
 */

export { GithubClient } from './GithubClient';
export {
  GithubClientError,
  type IGhPrResponse,
  type IGhCheckResponse,
  type IGhReviewResponse,
  type IGhReviewCommentResponse,
  type IGhReviewThreadResponse,
  type IGhIssueResponse,
  type IGhUserResponse,
  type IGithubClientOptions,
} from './types';
