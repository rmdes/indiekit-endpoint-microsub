/**
 * h-feed (Microformats2) normalization
 * @module feeds/normalizer-hfeed
 */

import {
  generateItemUid,
  extractImagesFromHtml,
  extractPhotoUrl,
  normalizeUrlArray,
  getFirst,
  getContentText,
  sanitizeHtml,
  SANITIZE_OPTIONS,
} from "./normalizer.js";

/**
 * Normalize h-card author
 * @param {object|string} hcard - h-card or author name string
 * @returns {object} Normalized author object
 */
function normalizeHcard(hcard) {
  if (typeof hcard === "string") {
    return { type: "card", name: hcard };
  }

  if (!hcard || !hcard.properties) {
    return;
  }

  const properties = hcard.properties;

  return {
    type: "card",
    name: getFirst(properties.name),
    url: getFirst(properties.url),
    photo: extractPhotoUrl(getFirst(properties.photo)),
  };
}

/**
 * Normalize h-feed entry
 * @param {object} entry - Microformats h-entry
 * @param {string} feedUrl - Feed URL
 * @returns {object} Normalized jf2 item
 */
export function normalizeHfeedItem(entry, feedUrl) {
  const properties = entry.properties || {};
  const url = getFirst(properties.url) || getFirst(properties.uid);
  const uid = generateItemUid(feedUrl, getFirst(properties.uid) || url);

  const normalized = {
    type: "entry",
    uid,
    url,
    _source: {
      url: feedUrl,
      feedUrl,
      feedType: "hfeed",
      originalId: getFirst(properties.uid),
    },
  };

  // Name/title
  if (properties.name) {
    const name = getFirst(properties.name);
    // Only include name if it's not just the content
    if (
      name &&
      (!properties.content || name !== getContentText(properties.content))
    ) {
      normalized.name = name;
    }
  }

  // Published
  if (properties.published) {
    const published = getFirst(properties.published);
    normalized.published = new Date(published).toISOString();
  }

  // Updated
  if (properties.updated) {
    const updated = getFirst(properties.updated);
    normalized.updated = new Date(updated).toISOString();
  }

  // Content
  if (properties.content) {
    const content = getFirst(properties.content);
    if (typeof content === "object") {
      normalized.content = {
        html: content.html
          ? sanitizeHtml(content.html, SANITIZE_OPTIONS)
          : undefined,
        text: content.value || undefined,
      };
    } else if (typeof content === "string") {
      normalized.content = { text: content };
    }
  }

  // Summary
  if (properties.summary) {
    normalized.summary = getFirst(properties.summary);
  }

  // Author
  if (properties.author) {
    const author = getFirst(properties.author);
    normalized.author = normalizeHcard(author);
  }

  // Categories
  if (properties.category) {
    normalized.category = properties.category;
  }

  // Photos
  if (properties.photo) {
    normalized.photo = properties.photo.map((p) =>
      typeof p === "object" ? p.value || p.url : p,
    );
  }

  // Videos
  if (properties.video) {
    normalized.video = properties.video.map((v) =>
      typeof v === "object" ? v.value || v.url : v,
    );
  }

  // Audio
  if (properties.audio) {
    normalized.audio = properties.audio.map((a) =>
      typeof a === "object" ? a.value || a.url : a,
    );
  }

  // Interaction types - normalize to string URLs
  if (properties["like-of"]) {
    normalized["like-of"] = normalizeUrlArray(properties["like-of"]);
  }
  if (properties["repost-of"]) {
    normalized["repost-of"] = normalizeUrlArray(properties["repost-of"]);
  }
  if (properties["bookmark-of"]) {
    normalized["bookmark-of"] = normalizeUrlArray(properties["bookmark-of"]);
  }
  if (properties["in-reply-to"]) {
    normalized["in-reply-to"] = normalizeUrlArray(properties["in-reply-to"]);
  }

  // RSVP
  if (properties.rsvp) {
    normalized.rsvp = getFirst(properties.rsvp);
  }

  // Syndication
  if (properties.syndication) {
    normalized.syndication = properties.syndication;
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
 * Normalize h-feed metadata
 * @param {object} hfeed - h-feed microformat object
 * @param {string} feedUrl - Feed URL
 * @returns {object} Normalized feed metadata
 */
export function normalizeHfeedMeta(hfeed, feedUrl) {
  const properties = hfeed.properties || {};

  const normalized = {
    name: getFirst(properties.name) || feedUrl,
  };

  if (properties.summary) {
    normalized.summary = getFirst(properties.summary);
  }

  if (properties.url) {
    normalized.url = getFirst(properties.url);
  }

  if (properties.photo) {
    normalized.photo = getFirst(properties.photo);
    if (typeof normalized.photo === "object") {
      normalized.photo = normalized.photo.value || normalized.photo.url;
    }
  }

  if (properties.author) {
    const author = getFirst(properties.author);
    normalized.author = normalizeHcard(author);
  }

  return normalized;
}
