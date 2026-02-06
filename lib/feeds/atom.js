/**
 * Atom feed parser
 * @module feeds/atom
 */

import { Readable } from "node:stream";

import FeedParser from "feedparser";

import { normalizeItem, normalizeFeedMeta } from "./normalizer.js";

/**
 * Parse Atom feed content
 * @param {string} content - Atom XML content
 * @param {string} feedUrl - URL of the feed
 * @returns {Promise<object>} Parsed feed with metadata and items
 */
export async function parseAtom(content, feedUrl) {
  return new Promise((resolve, reject) => {
    const feedparser = new FeedParser({ feedurl: feedUrl });
    const items = [];
    let meta;

    feedparser.on("error", (error) => {
      reject(new Error(`Atom parse error: ${error.message}`));
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
          normalizeItem(item, feedUrl, "atom"),
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
