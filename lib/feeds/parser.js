/**
 * Feed parser dispatcher
 * @module feeds/parser
 */

import { parseAtom } from "./atom.js";
import { parseHfeed } from "./hfeed.js";
import { parseJsonFeed } from "./jsonfeed.js";
import { parseRss } from "./rss.js";

/**
 * Detect feed type from content
 * @param {string} content - Feed content
 * @param {string} contentType - HTTP Content-Type header
 * @returns {string} Feed type: 'rss' | 'atom' | 'jsonfeed' | 'hfeed' | 'unknown'
 */
export function detectFeedType(content, contentType = "") {
  const ct = contentType.toLowerCase();

  // Check Content-Type header first
  if (ct.includes("application/json") || ct.includes("application/feed+json")) {
    return "jsonfeed";
  }

  if (ct.includes("application/atom+xml")) {
    return "atom";
  }

  if (
    ct.includes("application/rss+xml") ||
    ct.includes("application/xml") ||
    ct.includes("text/xml")
  ) {
    // Need to check content to distinguish RSS from Atom
    const trimmed = content.trim();
    if (
      trimmed.includes("<feed") &&
      trimmed.includes('xmlns="http://www.w3.org/2005/Atom"')
    ) {
      return "atom";
    }
    if (trimmed.includes("<rss") || trimmed.includes("<rdf:RDF")) {
      return "rss";
    }
  }

  if (ct.includes("text/html")) {
    return "hfeed";
  }

  // Fall back to content inspection
  const trimmed = content.trim();

  // JSON content
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed);
      // JSON Feed
      if (json.version && json.version.includes("jsonfeed.org")) {
        return "jsonfeed";
      }
      // ActivityPub - return special type to indicate we need feed discovery
      if (json["@context"] || json.type === "Group" || json.inbox) {
        return "activitypub";
      }
    } catch {
      // Not JSON
    }
  }

  // XML feeds
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<")) {
    if (
      trimmed.includes("<feed") &&
      trimmed.includes('xmlns="http://www.w3.org/2005/Atom"')
    ) {
      return "atom";
    }
    if (trimmed.includes("<rss") || trimmed.includes("<rdf:RDF")) {
      return "rss";
    }
  }

  // HTML with potential h-feed
  if (trimmed.includes("<!DOCTYPE html") || trimmed.includes("<html")) {
    return "hfeed";
  }

  return "unknown";
}

/**
 * Parse feed content into normalized items
 * @param {string} content - Feed content
 * @param {string} feedUrl - URL of the feed
 * @param {object} options - Parse options
 * @param {string} [options.contentType] - HTTP Content-Type header
 * @returns {Promise<object>} Parsed feed with metadata and items
 */
export async function parseFeed(content, feedUrl, options = {}) {
  const feedType = detectFeedType(content, options.contentType);

  switch (feedType) {
    case "rss": {
      return parseRss(content, feedUrl);
    }

    case "atom": {
      return parseAtom(content, feedUrl);
    }

    case "jsonfeed": {
      return parseJsonFeed(content, feedUrl);
    }

    case "hfeed": {
      return parseHfeed(content, feedUrl);
    }

    case "activitypub": {
      throw new Error(
        `URL returns ActivityPub JSON instead of a feed. Try the direct feed URL (e.g., ${feedUrl}feed/)`,
      );
    }

    default: {
      throw new Error(`Unable to detect feed type for ${feedUrl}`);
    }
  }
}

export { parseAtom } from "./atom.js";
export { parseHfeed } from "./hfeed.js";
export { parseJsonFeed } from "./jsonfeed.js";
export { parseRss } from "./rss.js";
