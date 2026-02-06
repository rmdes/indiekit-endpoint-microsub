/**
 * Feed fetcher with HTTP caching
 * @module feeds/fetcher
 */

import { getCache, setCache } from "../cache/redis.js";

const DEFAULT_TIMEOUT = 30_000; // 30 seconds
const DEFAULT_USER_AGENT = "Indiekit Microsub/1.0 (+https://getindiekit.com)";

/**
 * Fetch feed content with caching
 * @param {string} url - Feed URL
 * @param {object} options - Fetch options
 * @param {string} [options.etag] - Previous ETag for conditional request
 * @param {string} [options.lastModified] - Previous Last-Modified for conditional request
 * @param {number} [options.timeout] - Request timeout in ms
 * @param {object} [options.redis] - Redis client for caching
 * @returns {Promise<object>} Fetch result with content and headers
 */
export async function fetchFeed(url, options = {}) {
  const { etag, lastModified, timeout = DEFAULT_TIMEOUT, redis } = options;

  // Check cache first
  if (redis) {
    const cached = await getCache(redis, `feed:${url}`);
    if (cached) {
      return {
        content: cached.content,
        contentType: cached.contentType,
        etag: cached.etag,
        lastModified: cached.lastModified,
        fromCache: true,
        status: 200,
      };
    }
  }

  const headers = {
    Accept:
      "application/atom+xml, application/rss+xml, application/json, application/feed+json, text/xml, text/html;q=0.9, */*;q=0.8",
    "User-Agent": DEFAULT_USER_AGENT,
  };

  // Add conditional request headers
  if (etag) {
    headers["If-None-Match"] = etag;
  }
  if (lastModified) {
    headers["If-Modified-Since"] = lastModified;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeoutId);

    // Not modified - use cached version
    if (response.status === 304) {
      return {
        content: undefined,
        contentType: undefined,
        etag,
        lastModified,
        notModified: true,
        status: 304,
      };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();
    const responseEtag = response.headers.get("ETag");
    const responseLastModified = response.headers.get("Last-Modified");
    const contentType = response.headers.get("Content-Type") || "";

    const result = {
      content,
      contentType,
      etag: responseEtag,
      lastModified: responseLastModified,
      fromCache: false,
      status: response.status,
    };

    // Extract hub URL from Link header for WebSub
    const linkHeader = response.headers.get("Link");
    if (linkHeader) {
      result.hub = extractHubFromLinkHeader(linkHeader);
      result.self = extractSelfFromLinkHeader(linkHeader);
    }

    // Cache the result
    if (redis) {
      const cacheData = {
        content,
        contentType,
        etag: responseEtag,
        lastModified: responseLastModified,
      };
      // Cache for 5 minutes by default
      await setCache(redis, `feed:${url}`, cacheData, 300);
    }

    return result;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeout}ms`);
    }

    throw error;
  }
}

/**
 * Extract hub URL from Link header
 * @param {string} linkHeader - Link header value
 * @returns {string|undefined} Hub URL
 */
function extractHubFromLinkHeader(linkHeader) {
  const hubMatch = linkHeader.match(/<([^>]+)>;\s*rel=["']?hub["']?/i);
  return hubMatch ? hubMatch[1] : undefined;
}

/**
 * Extract self URL from Link header
 * @param {string} linkHeader - Link header value
 * @returns {string|undefined} Self URL
 */
function extractSelfFromLinkHeader(linkHeader) {
  const selfMatch = linkHeader.match(/<([^>]+)>;\s*rel=["']?self["']?/i);
  return selfMatch ? selfMatch[1] : undefined;
}

/**
 * Fetch feed and parse it
 * @param {string} url - Feed URL
 * @param {object} options - Options
 * @returns {Promise<object>} Parsed feed
 */
export async function fetchAndParseFeed(url, options = {}) {
  const { parseFeed, detectFeedType } = await import("./parser.js");

  const result = await fetchFeed(url, options);

  if (result.notModified) {
    return {
      ...result,
      items: [],
    };
  }

  // Check if we got a parseable feed
  const feedType = detectFeedType(result.content, result.contentType);

  // If we got ActivityPub or unknown, try common feed paths
  if (feedType === "activitypub" || feedType === "unknown") {
    const fallbackFeed = await tryCommonFeedPaths(url, options);
    if (fallbackFeed) {
      // Fetch and parse the discovered feed
      const feedResult = await fetchFeed(fallbackFeed.url, options);
      if (!feedResult.notModified) {
        const parsed = await parseFeed(feedResult.content, fallbackFeed.url, {
          contentType: feedResult.contentType,
        });
        return {
          ...feedResult,
          ...parsed,
          hub: feedResult.hub || parsed._hub,
          discoveredFrom: url,
        };
      }
    }
    throw new Error(
      `Unable to find a feed at ${url}. Try the direct feed URL.`,
    );
  }

  const parsed = await parseFeed(result.content, url, {
    contentType: result.contentType,
  });

  return {
    ...result,
    ...parsed,
    hub: result.hub || parsed._hub,
  };
}

/**
 * Common feed paths to try when discovery fails
 */
const COMMON_FEED_PATHS = ["/feed/", "/feed", "/rss", "/rss.xml", "/atom.xml"];

/**
 * Try to fetch a feed from common paths
 * @param {string} baseUrl - Base URL of the site
 * @param {object} options - Fetch options
 * @returns {Promise<object|undefined>} Feed result or undefined
 */
async function tryCommonFeedPaths(baseUrl, options = {}) {
  const base = new URL(baseUrl);

  for (const feedPath of COMMON_FEED_PATHS) {
    const feedUrl = new URL(feedPath, base).href;
    try {
      const result = await fetchFeed(feedUrl, { ...options, timeout: 10_000 });
      const contentType = result.contentType?.toLowerCase() || "";

      // Check if we got a feed
      if (
        contentType.includes("xml") ||
        contentType.includes("rss") ||
        contentType.includes("atom") ||
        (contentType.includes("json") &&
          result.content?.includes("jsonfeed.org"))
      ) {
        return {
          url: feedUrl,
          type: contentType.includes("json") ? "jsonfeed" : "xml",
          rel: "alternate",
        };
      }
    } catch {
      // Try next path
    }
  }

  return;
}

/**
 * Discover feeds from a URL
 * @param {string} url - Page URL
 * @param {object} options - Options
 * @returns {Promise<Array>} Array of discovered feeds
 */
export async function discoverFeedsFromUrl(url, options = {}) {
  const result = await fetchFeed(url, options);
  const { discoverFeeds } = await import("./hfeed.js");

  // If it's already a feed, return it
  const contentType = result.contentType?.toLowerCase() || "";
  if (
    contentType.includes("xml") ||
    contentType.includes("rss") ||
    contentType.includes("atom")
  ) {
    return [
      {
        url,
        type: "xml",
        rel: "self",
      },
    ];
  }

  // Check for JSON Feed specifically
  if (
    contentType.includes("json") &&
    result.content?.includes("jsonfeed.org")
  ) {
    return [
      {
        url,
        type: "jsonfeed",
        rel: "self",
      },
    ];
  }

  // Check if we got ActivityPub JSON or other non-feed JSON
  // This happens with WordPress sites using ActivityPub plugin
  if (
    contentType.includes("json") ||
    (result.content?.trim().startsWith("{") &&
      result.content?.includes("@context"))
  ) {
    // Try common feed paths as fallback
    const fallbackFeed = await tryCommonFeedPaths(url, options);
    if (fallbackFeed) {
      return [fallbackFeed];
    }
  }

  // If content looks like HTML, discover feeds from it
  if (
    contentType.includes("html") ||
    result.content?.includes("<!DOCTYPE html") ||
    result.content?.includes("<html")
  ) {
    const feeds = await discoverFeeds(result.content, url);
    if (feeds.length > 0) {
      return feeds;
    }
  }

  // Last resort: try common feed paths
  const fallbackFeed = await tryCommonFeedPaths(url, options);
  if (fallbackFeed) {
    return [fallbackFeed];
  }

  return [];
}
