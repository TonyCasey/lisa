/**
 * PR Command Handlers
 *
 * Handlers for PR-related CLI commands:
 * - create: Create PR with auto-generated body
 * - review: Run local AI code review
 * - checks: Get CI check status for a PR
 * - comments: Fetch and display PR review comments
 * - watch/unwatch: Manage PR watch list
 * - watching: List all watched PRs
 * - poll: Cron-based polling for state changes
 * - status: Multi-PR summary dashboard
 * - link: Link PR to issue (CLOSES relationship)
 */

export { PrCreateHandler, type IPrCreateResult, type IPrCreateOptions } from './PrCreateHandler';
export { PrReviewHandler, type IPrReviewResult, type IPrReviewOptions, type IReviewIssue } from './PrReviewHandler';
export { PrChecksHandler, type IPrChecksResult } from './PrChecksHandler';
export { PrCommentsHandler, type IPrCommentsResult } from './PrCommentsHandler';
export { PrAddressHandler, type IPrAddressResult, type IPrAddressOptions, type ICommentToAddress, type CommentType } from './PrAddressHandler';
export { PrWatchHandler, type IPrWatchResult } from './PrWatchHandler';
export { PrPollHandler, type IPrPollResult, type IPrPollOptions, type IPrPollItem, type IStateChange, type IAutoAddressOutput } from './PrPollHandler';
export { PrStatusHandler, type IPrStatusResult, type IPrStatusOptions, type IPrStatusItem, type IPrsByRepo, type IPrStatusSummary, type ReadyState } from './PrStatusHandler';
export { PrLinkHandler, type IPrLinkResult, type IPrLinkOptions } from './PrLinkHandler';
