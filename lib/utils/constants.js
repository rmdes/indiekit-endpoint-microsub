/**
 * Shared constants used across multiple modules
 * @module utils/constants
 */

/** Retention period for unread count queries (only count recent items) */
export const UNREAD_RETENTION_DAYS = 30;

/**
 * Maximum number of full read items to keep per channel/user before stripping
 * content. Items beyond this limit are converted to lightweight dedup skeletons
 * (channelId, uid, readBy) so the poller doesn't re-ingest them as new unread.
 */
export const MAX_FULL_READ_ITEMS = 200;
