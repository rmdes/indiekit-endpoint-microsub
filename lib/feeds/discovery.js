/**
 * Enhanced feed discovery with type labels and validation
 * @module feeds/discovery
 */

import { discoverFeedsFromUrl } from "./fetcher.js";
import { validateFeedUrl } from "./validator.js";

/**
 * Feed type display labels
 */
const FEED_TYPE_LABELS = {
  rss: "RSS Feed",
  atom: "Atom Feed",
  jsonfeed: "JSON Feed",
  hfeed: "h-feed (Microformats)",
  activitypub: "ActivityPub",
  unknown: "Unknown",
};

/**
 * Discover and validate all feeds from a URL
 * @param {string} url - Page or feed URL
 * @returns {Promise<Array>} Array of discovered feeds with validation status
 */
export async function discoverAndValidateFeeds(url) {
  // First discover feeds from the URL
  const feeds = await discoverFeedsFromUrl(url);

  // If no feeds found, return empty with error info
  if (feeds.length === 0) {
    return [
      {
        url,
        type: "unknown",
        typeLabel: "No feed found",
        valid: false,
        error: "No feeds were discovered at this URL",
        isCommentsFeed: false,
      },
    ];
  }

  // Validate each discovered feed in parallel
  const validatedFeeds = await Promise.all(
    feeds.map(async (feed) => {
      const validation = await validateFeedUrl(feed.url);

      return {
        url: feed.url,
        type: validation.feedType || feed.type,
        typeLabel:
          FEED_TYPE_LABELS[validation.feedType] ||
          FEED_TYPE_LABELS[feed.type] ||
          "Feed",
        valid: validation.valid,
        error: validation.error,
        isCommentsFeed: validation.isCommentsFeed || false,
        title: validation.title || feed.title,
        rel: feed.rel,
      };
    }),
  );

  // Sort: valid feeds first, non-comments before comments, then alphabetically
  return validatedFeeds.sort((a, b) => {
    // Valid feeds first
    if (a.valid !== b.valid) return a.valid ? -1 : 1;
    // Non-comments before comments
    if (a.isCommentsFeed !== b.isCommentsFeed) return a.isCommentsFeed ? 1 : -1;
    // Then by URL
    return a.url.localeCompare(b.url);
  });
}

/**
 * Filter to only main content feeds (exclude comments)
 * @param {Array} feeds - Array of feed objects
 * @returns {Array} Filtered array of main content feeds
 */
export function filterMainFeeds(feeds) {
  return feeds.filter((feed) => feed.valid && !feed.isCommentsFeed);
}

/**
 * Get the best feed from a list (first valid, non-comments feed)
 * @param {Array} feeds - Array of feed objects
 * @returns {object|undefined} Best feed or undefined
 */
export function getBestFeed(feeds) {
  const mainFeeds = filterMainFeeds(feeds);
  return mainFeeds.length > 0 ? mainFeeds[0] : undefined;
}

export { FEED_TYPE_LABELS };
