/**
 * JSON Feed parser
 * @module feeds/jsonfeed
 */

import { normalizeJsonFeedItem, normalizeJsonFeedMeta } from "./normalizer.js";

/**
 * Parse JSON Feed content
 * @param {string} content - JSON Feed content
 * @param {string} feedUrl - URL of the feed
 * @returns {Promise<object>} Parsed feed with metadata and items
 */
export async function parseJsonFeed(content, feedUrl) {
  let feed;

  try {
    feed = typeof content === "string" ? JSON.parse(content) : content;
  } catch (error) {
    throw new Error(`JSON Feed parse error: ${error.message}`);
  }

  // Validate JSON Feed structure
  if (!feed.version || !feed.version.includes("jsonfeed.org")) {
    throw new Error("Invalid JSON Feed: missing or invalid version");
  }

  if (!Array.isArray(feed.items)) {
    throw new TypeError("Invalid JSON Feed: items must be an array");
  }

  const normalizedMeta = normalizeJsonFeedMeta(feed, feedUrl);
  const normalizedItems = feed.items.map((item) =>
    normalizeJsonFeedItem(item, feedUrl),
  );

  return {
    type: "feed",
    url: feedUrl,
    ...normalizedMeta,
    items: normalizedItems,
  };
}
