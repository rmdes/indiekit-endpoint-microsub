/**
 * RSS/Atom feed normalization
 * @module feeds/normalizer-rss
 */

import {
  generateItemUid,
  toISOStringSafe,
  extractImagesFromHtml,
  sanitizeHtml,
  SANITIZE_OPTIONS,
} from "./normalizer.js";

/**
 * Normalize RSS/Atom item from feedparser
 * @param {object} item - Feedparser item
 * @param {string} feedUrl - Feed URL
 * @param {string} feedType - 'rss' or 'atom'
 * @returns {object} Normalized jf2 item
 */
export function normalizeItem(item, feedUrl, feedType) {
  const url = item.link || item.origlink || item.guid;
  const uid = generateItemUid(feedUrl, item.guid || url || item.title);

  const normalized = {
    type: "entry",
    uid,
    url,
    name: item.title
      ? sanitizeHtml(item.title, { allowedTags: [] }).trim()
      : undefined,
    published: toISOStringSafe(item.pubdate),
    updated: toISOStringSafe(item.date),
    _source: {
      url: feedUrl,
      feedUrl,
      feedType,
      originalId: item.guid,
    },
  };

  // Content
  if (item.description || item.summary) {
    const html = item.description || item.summary;
    normalized.content = {
      html: sanitizeHtml(html, SANITIZE_OPTIONS),
      text: sanitizeHtml(html, { allowedTags: [] }).trim(),
    };
  }

  // Summary (prefer explicit summary over truncated content)
  if (item.summary && item.description && item.summary !== item.description) {
    normalized.summary = sanitizeHtml(item.summary, { allowedTags: [] }).trim();
  }

  // Author
  if (item.author || item["dc:creator"]) {
    const authorName = item.author || item["dc:creator"];
    normalized.author = {
      type: "card",
      name: authorName,
    };
  }

  // Categories/tags
  if (item.categories && item.categories.length > 0) {
    normalized.category = item.categories;
  }

  // Enclosures (media)
  if (item.enclosures && item.enclosures.length > 0) {
    for (const enclosure of item.enclosures) {
      const mediaUrl = enclosure.url;
      const mediaType = enclosure.type || "";

      if (mediaType.startsWith("image/")) {
        normalized.photo = normalized.photo || [];
        normalized.photo.push(mediaUrl);
      } else if (mediaType.startsWith("video/")) {
        normalized.video = normalized.video || [];
        normalized.video.push(mediaUrl);
      } else if (mediaType.startsWith("audio/")) {
        normalized.audio = normalized.audio || [];
        normalized.audio.push(mediaUrl);
      }
    }
  }

  // Featured image from media content
  if (item["media:content"] && item["media:content"].url) {
    const mediaType = item["media:content"].type || "";
    if (
      mediaType.startsWith("image/") ||
      item["media:content"].medium === "image"
    ) {
      normalized.photo = normalized.photo || [];
      if (!normalized.photo.includes(item["media:content"].url)) {
        normalized.photo.push(item["media:content"].url);
      }
    }
  }

  // Image from item.image
  if (item.image && item.image.url) {
    normalized.photo = normalized.photo || [];
    if (!normalized.photo.includes(item.image.url)) {
      normalized.photo.push(item.image.url);
    }
  }

  // Extract images from HTML content as fallback
  if (!normalized.photo && normalized.content?.html) {
    const extracted = extractImagesFromHtml(normalized.content.html);
    if (extracted.length > 0) {
      normalized.photo = extracted;
    }
  }

  return normalized;
}

/**
 * Normalize feed metadata from feedparser
 * @param {object} meta - Feedparser meta object
 * @param {string} feedUrl - Feed URL
 * @returns {object} Normalized feed metadata
 */
export function normalizeFeedMeta(meta, feedUrl) {
  const normalized = {
    name: meta.title
      ? sanitizeHtml(meta.title, { allowedTags: [] }).trim()
      : feedUrl,
  };

  if (meta.description) {
    normalized.summary = meta.description;
  }

  if (meta.link) {
    normalized.url = meta.link;
  }

  if (meta.image && meta.image.url) {
    normalized.photo = meta.image.url;
  }

  if (meta.favicon) {
    normalized.photo = normalized.photo || meta.favicon;
  }

  // Author/publisher
  if (meta.author) {
    normalized.author = {
      type: "card",
      name: meta.author,
    };
  }

  // Hub for WebSub
  if (meta.cloud && meta.cloud.href) {
    normalized._hub = meta.cloud.href;
  }

  // Look for hub in links
  if (meta.link && meta["atom:link"]) {
    const links = Array.isArray(meta["atom:link"])
      ? meta["atom:link"]
      : [meta["atom:link"]];
    for (const link of links) {
      if (link["@"] && link["@"].rel === "hub") {
        normalized._hub = link["@"].href;
        break;
      }
    }
  }

  return normalized;
}
