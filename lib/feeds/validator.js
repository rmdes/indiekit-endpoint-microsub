/**
 * Feed validation utilities
 * @module feeds/validator
 */

import { fetchFeed } from "./fetcher.js";
import { detectFeedType } from "./parser.js";

/**
 * Feed types that are valid subscriptions
 */
const VALID_FEED_TYPES = ["rss", "atom", "jsonfeed", "hfeed"];

/**
 * Patterns that indicate a comments feed (not a main feed)
 */
const COMMENTS_PATTERNS = [
  /\/comments\/?$/i,
  /\/feed\/comments/i,
  /commentsfeed/i,
  /comment-feed/i,
  /-comments\.xml$/i,
  /\/replies\/?$/i,
  /comments\.rss$/i,
  /comments\.atom$/i,
];

/**
 * Validate a URL is actually a feed
 * @param {string} url - URL to validate
 * @returns {Promise<object>} Validation result
 */
export async function validateFeedUrl(url) {
  try {
    const result = await fetchFeed(url, { timeout: 15000 });

    if (result.notModified || !result.content) {
      return {
        valid: false,
        error: "Unable to fetch content from URL",
      };
    }

    const feedType = detectFeedType(result.content, result.contentType);

    if (feedType === "activitypub") {
      return {
        valid: false,
        error:
          "URL returns ActivityPub JSON instead of a feed. Try the direct feed URL.",
        feedType,
      };
    }

    if (!VALID_FEED_TYPES.includes(feedType)) {
      return {
        valid: false,
        error: `URL does not contain a valid feed (detected: ${feedType})`,
        feedType,
      };
    }

    // Check if it's a comments feed
    const isCommentsFeed = COMMENTS_PATTERNS.some((pattern) =>
      pattern.test(url),
    );

    return {
      valid: true,
      feedType,
      isCommentsFeed,
      title: extractFeedTitle(result.content, feedType),
      contentType: result.contentType,
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
    };
  }
}

/**
 * Extract feed title from content
 * @param {string} content - Feed content
 * @param {string} feedType - Type of feed
 * @returns {string|undefined} Feed title
 */
function extractFeedTitle(content, feedType) {
  if (feedType === "jsonfeed") {
    try {
      const json = JSON.parse(content);
      return json.title;
    } catch {
      return undefined;
    }
  }

  // Extract title from XML (RSS or Atom)
  // Try channel/title first (RSS), then just title (Atom)
  const channelTitleMatch = content.match(
    /<channel[^>]*>[\s\S]*?<title[^>]*>([^<]+)<\/title>/i,
  );
  if (channelTitleMatch) {
    return decodeXmlEntities(channelTitleMatch[1].trim());
  }

  const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? decodeXmlEntities(titleMatch[1].trim()) : undefined;
}

/**
 * Decode XML entities
 * @param {string} str - String with XML entities
 * @returns {string} Decoded string
 */
function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16)),
    );
}
