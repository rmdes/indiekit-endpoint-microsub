/**
 * Resolve metadata (name, photo, site url) of an item-level <source> feed.
 * Aggregator feeds attribute each item to its originating feed via the
 * RSS 2.0 <source url="..."> element; fetching that feed's channel image
 * gives us the author's avatar. Results are cached in memory so each
 * distinct source feed is fetched at most once per TTL.
 * @module feeds/source-meta
 */

import { fetchAndParseFeed } from "./fetcher.js";

const TTL = 24 * 60 * 60 * 1000; // 24h — feed titles/avatars change rarely
const MAX_CACHE_ENTRIES = 500;

/** @type {Map<string, { promise: Promise<object|undefined>, fetchedAt: number }>} */
const cache = new Map();

/**
 * Resolve a source feed's metadata, cached
 * @param {string} url - Source feed URL
 * @returns {Promise<object|undefined>} { name, photo, url } or undefined on failure
 */
export async function resolveSourceFeedMeta(url) {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.fetchedAt < TTL) {
    return hit.promise;
  }

  // ponytail: crude full-clear eviction; LRU if churn ever matters
  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.clear();
  }

  const promise = fetchAndParseFeed(url, { timeout: 10_000 })
    .then((parsed) => ({
      name: parsed.name,
      photo: parsed.photo,
      url: parsed.url,
    }))
    // Failures are cached too (negative cache) — avoids hammering dead feeds
    .catch(() => {});

  cache.set(url, { promise, fetchedAt: now });
  return promise;
}
