/**
 * h-feed (Microformats2) parser
 * @module feeds/hfeed
 */

import { mf2 } from "microformats-parser";

import { normalizeHfeedItem, normalizeHfeedMeta } from "./normalizer.js";

/**
 * Parse h-feed content from HTML
 * @param {string} content - HTML content with h-feed
 * @param {string} feedUrl - URL of the page
 * @returns {Promise<object>} Parsed feed with metadata and items
 */
export async function parseHfeed(content, feedUrl) {
  let parsed;

  try {
    parsed = mf2(content, { baseUrl: feedUrl });
  } catch (error) {
    throw new Error(`h-feed parse error: ${error.message}`);
  }

  // Find h-feed in the parsed microformats
  const hfeed = findHfeed(parsed);

  if (!hfeed) {
    // If no h-feed, look for h-entry items at the root
    const entries = parsed.items.filter(
      (item) => item.type && item.type.includes("h-entry"),
    );

    if (entries.length === 0) {
      throw new Error("No h-feed or h-entry found on page");
    }

    // Create synthetic feed from entries
    return {
      type: "feed",
      url: feedUrl,
      name: parsed.rels?.canonical?.[0] || feedUrl,
      items: entries.map((entry) => normalizeHfeedItem(entry, feedUrl)),
    };
  }

  const normalizedMeta = normalizeHfeedMeta(hfeed, feedUrl);

  // Get children entries from h-feed
  const entries = hfeed.children || [];
  const normalizedItems = entries
    .filter((child) => child.type && child.type.includes("h-entry"))
    .map((entry) => normalizeHfeedItem(entry, feedUrl));

  return {
    type: "feed",
    url: feedUrl,
    ...normalizedMeta,
    items: normalizedItems,
  };
}

/**
 * Find h-feed in parsed microformats
 * @param {object} parsed - Parsed microformats object
 * @returns {object|undefined} h-feed object or undefined
 */
function findHfeed(parsed) {
  // Look for h-feed at top level
  for (const item of parsed.items) {
    if (item.type && item.type.includes("h-feed")) {
      return item;
    }

    // Check nested children
    if (item.children) {
      for (const child of item.children) {
        if (child.type && child.type.includes("h-feed")) {
          return child;
        }
      }
    }
  }

  return;
}

/**
 * Discover feeds from HTML page
 * @param {string} content - HTML content
 * @param {string} pageUrl - URL of the page
 * @returns {Promise<Array>} Array of discovered feed URLs with types
 */
export async function discoverFeeds(content, pageUrl) {
  const feeds = [];
  const parsed = mf2(content, { baseUrl: pageUrl });

  // Check for rel="alternate" feed links
  const alternates = parsed.rels?.alternate || [];
  for (const url of alternates) {
    // Try to determine feed type from URL
    if (url.includes("feed") || url.endsWith(".xml") || url.endsWith(".json")) {
      feeds.push({
        url,
        type: "unknown",
        rel: "alternate",
      });
    }
  }

  // Check for rel="feed" links (Microsub discovery)
  const feedLinks = parsed.rels?.feed || [];
  for (const url of feedLinks) {
    feeds.push({
      url,
      type: "hfeed",
      rel: "feed",
    });
  }

  // Check if page itself has h-feed
  const hfeed = findHfeed(parsed);
  if (hfeed) {
    feeds.push({
      url: pageUrl,
      type: "hfeed",
      rel: "self",
    });
  }

  // Parse <link> elements for feed discovery
  const linkFeeds = extractLinkFeeds(content, pageUrl);
  feeds.push(...linkFeeds);

  return feeds;
}

/**
 * Extract feed links from HTML <link> elements
 * @param {string} content - HTML content
 * @param {string} baseUrl - Base URL for resolving relative URLs
 * @returns {Array} Array of discovered feeds
 */
function extractLinkFeeds(content, baseUrl) {
  const feeds = [];
  const linkRegex = /<link[^>]+rel=["'](?:alternate|feed)["'][^>]*>/gi;
  const matches = content.match(linkRegex) || [];

  for (const link of matches) {
    const hrefMatch = link.match(/href=["']([^"']+)["']/i);
    const typeMatch = link.match(/type=["']([^"']+)["']/i);

    if (hrefMatch) {
      const href = hrefMatch[1];
      const type = typeMatch ? typeMatch[1] : "unknown";
      const url = new URL(href, baseUrl).href;

      let feedType = "unknown";
      if (type.includes("rss")) {
        feedType = "rss";
      } else if (type.includes("atom")) {
        feedType = "atom";
      } else if (type.includes("json")) {
        feedType = "jsonfeed";
      }

      feeds.push({
        url,
        type: feedType,
        contentType: type,
        rel: "link",
      });
    }
  }

  return feeds;
}
