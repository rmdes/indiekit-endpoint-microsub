/**
 * RSS 1.0/2.0 feed parser
 * @module feeds/rss
 */

import { Readable } from "node:stream";

import FeedParser from "feedparser";

import { normalizeItem, normalizeFeedMeta } from "./normalizer.js";

/**
 * Parse RSS feed content
 * @param {string} content - RSS XML content
 * @param {string} feedUrl - URL of the feed
 * @returns {Promise<object>} Parsed feed with metadata and items
 */
export async function parseRss(content, feedUrl) {
  return new Promise((resolve, reject) => {
    const feedparser = new FeedParser({ feedurl: feedUrl });
    const items = [];
    let meta;

    feedparser.on("error", (error) => {
      reject(new Error(`RSS parse error: ${error.message}`));
    });

    feedparser.on("meta", (feedMeta) => {
      meta = feedMeta;
    });

    feedparser.on("readable", function () {
      let item;
      while ((item = this.read())) {
        items.push(item);
      }
    });

    feedparser.on("end", () => {
      try {
        const normalizedMeta = normalizeFeedMeta(meta, feedUrl);
        const normalizedItems = items.map((item) =>
          normalizeItem(item, feedUrl, "rss"),
        );

        resolve({
          type: "feed",
          url: feedUrl,
          ...normalizedMeta,
          items: normalizedItems,
        });
      } catch (error) {
        reject(error);
      }
    });

    // Create readable stream from string and pipe to feedparser
    const stream = Readable.from([content]);
    stream.pipe(feedparser);
  });
}
