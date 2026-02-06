/**
 * Feed normalizer - converts all feed formats to jf2
 * @module feeds/normalizer
 */

import crypto from "node:crypto";

import sanitizeHtml from "sanitize-html";

/**
 * Parse a date string with fallback for non-standard formats
 * @param {string|Date} dateInput - Date string or Date object
 * @returns {Date|undefined} Parsed Date or undefined if invalid
 */
function parseDate(dateInput) {
  if (!dateInput) {
    return;
  }

  // Already a valid Date
  if (dateInput instanceof Date && !Number.isNaN(dateInput.getTime())) {
    return dateInput;
  }

  const dateString = String(dateInput).trim();

  // Try standard parsing first
  let date = new Date(dateString);
  if (!Number.isNaN(date.getTime())) {
    return date;
  }

  // Handle "YYYY-MM-DD HH:MM" format (missing seconds and timezone)
  // e.g., "2026-01-28 08:40"
  const shortDateTime = dateString.match(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/,
  );
  if (shortDateTime) {
    date = new Date(`${shortDateTime[1]}T${shortDateTime[2]}:00Z`);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  // Handle "YYYY-MM-DD HH:MM:SS" without timezone
  const dateTimeNoTz = dateString.match(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/,
  );
  if (dateTimeNoTz) {
    date = new Date(`${dateTimeNoTz[1]}T${dateTimeNoTz[2]}Z`);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  // If all else fails, return undefined
  return;
}

/**
 * Safely convert date to ISO string
 * @param {string|Date} dateInput - Date input
 * @returns {string|undefined} ISO string or undefined
 */
function toISOStringSafe(dateInput) {
  const date = parseDate(dateInput);
  return date ? date.toISOString() : undefined;
}

/**
 * Sanitize HTML options
 */
const SANITIZE_OPTIONS = {
  allowedTags: [
    "a",
    "abbr",
    "b",
    "blockquote",
    "br",
    "code",
    "em",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strike",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
    "video",
    "audio",
    "source",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    video: ["src", "poster", "controls", "width", "height"],
    audio: ["src", "controls"],
    source: ["src", "type"],
    "*": ["class"],
  },
  allowedSchemes: ["http", "https", "mailto"],
};

/**
 * Generate unique ID for an item
 * @param {string} feedUrl - Feed URL
 * @param {string} itemId - Item identifier (URL or ID)
 * @returns {string} Unique ID hash
 */
export function generateItemUid(feedUrl, itemId) {
  const hash = crypto.createHash("sha256");
  hash.update(`${feedUrl}::${itemId}`);
  return hash.digest("hex").slice(0, 24);
}

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
    name: item.title || undefined,
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
    name: meta.title || feedUrl,
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

/**
 * Normalize JSON Feed item
 * @param {object} item - JSON Feed item
 * @param {string} feedUrl - Feed URL
 * @returns {object} Normalized jf2 item
 */
export function normalizeJsonFeedItem(item, feedUrl) {
  const url = item.url || item.external_url;
  const uid = generateItemUid(feedUrl, item.id || url);

  const normalized = {
    type: "entry",
    uid,
    url,
    name: item.title || undefined,
    published: item.date_published
      ? new Date(item.date_published).toISOString()
      : undefined,
    updated: item.date_modified
      ? new Date(item.date_modified).toISOString()
      : undefined,
    _source: {
      url: feedUrl,
      feedUrl,
      feedType: "jsonfeed",
      originalId: item.id,
    },
  };

  // Content
  if (item.content_html || item.content_text) {
    normalized.content = {};
    if (item.content_html) {
      normalized.content.html = sanitizeHtml(
        item.content_html,
        SANITIZE_OPTIONS,
      );
      normalized.content.text = sanitizeHtml(item.content_html, {
        allowedTags: [],
      }).trim();
    } else if (item.content_text) {
      normalized.content.text = item.content_text;
    }
  }

  // Summary
  if (item.summary) {
    normalized.summary = item.summary;
  }

  // Author
  if (item.author || item.authors) {
    const author = item.author || (item.authors && item.authors[0]);
    if (author) {
      normalized.author = {
        type: "card",
        name: author.name,
        url: author.url,
        photo: author.avatar,
      };
    }
  }

  // Tags
  if (item.tags && item.tags.length > 0) {
    normalized.category = item.tags;
  }

  // Featured image
  if (item.image) {
    normalized.photo = [item.image];
  }

  if (item.banner_image && !normalized.photo) {
    normalized.photo = [item.banner_image];
  }

  // Attachments
  if (item.attachments && item.attachments.length > 0) {
    for (const attachment of item.attachments) {
      const mediaType = attachment.mime_type || "";

      if (mediaType.startsWith("image/")) {
        normalized.photo = normalized.photo || [];
        normalized.photo.push(attachment.url);
      } else if (mediaType.startsWith("video/")) {
        normalized.video = normalized.video || [];
        normalized.video.push(attachment.url);
      } else if (mediaType.startsWith("audio/")) {
        normalized.audio = normalized.audio || [];
        normalized.audio.push(attachment.url);
      }
    }
  }

  // External URL
  if (item.external_url && item.url !== item.external_url) {
    normalized["bookmark-of"] = [item.external_url];
  }

  return normalized;
}

/**
 * Normalize JSON Feed metadata
 * @param {object} feed - JSON Feed object
 * @param {string} feedUrl - Feed URL
 * @returns {object} Normalized feed metadata
 */
export function normalizeJsonFeedMeta(feed, feedUrl) {
  const normalized = {
    name: feed.title || feedUrl,
  };

  if (feed.description) {
    normalized.summary = feed.description;
  }

  if (feed.home_page_url) {
    normalized.url = feed.home_page_url;
  }

  if (feed.icon) {
    normalized.photo = feed.icon;
  } else if (feed.favicon) {
    normalized.photo = feed.favicon;
  }

  if (feed.author || feed.authors) {
    const author = feed.author || (feed.authors && feed.authors[0]);
    if (author) {
      normalized.author = {
        type: "card",
        name: author.name,
        url: author.url,
        photo: author.avatar,
      };
    }
  }

  // Hub for WebSub
  if (feed.hubs && feed.hubs.length > 0) {
    normalized._hub = feed.hubs[0].url;
  }

  return normalized;
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

/**
 * Extract URL string from a photo value
 * @param {object|string} photo - Photo value (can be string URL or object with value/url)
 * @returns {string|undefined} Photo URL string
 */
function extractPhotoUrl(photo) {
  if (!photo) {
    return;
  }
  if (typeof photo === "string") {
    return photo;
  }
  if (typeof photo === "object") {
    return photo.value || photo.url || photo.src;
  }
  return;
}

/**
 * Extract URL string from a value that may be string or object
 * @param {object|string} value - URL string or object with url/value property
 * @returns {string|undefined} URL string
 */
function extractUrl(value) {
  if (!value) {
    return;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    return value.value || value.url || value.href;
  }
  return;
}

/**
 * Normalize an array of URLs that may contain strings or objects
 * @param {Array} urls - Array of URL strings or objects
 * @returns {Array<string>} Array of URL strings
 */
function normalizeUrlArray(urls) {
  if (!urls || !Array.isArray(urls)) {
    return [];
  }
  return urls.map((u) => extractUrl(u)).filter(Boolean);
}

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
 * Get first item from array or return the value itself
 * @param {Array|*} value - Value or array of values
 * @returns {*} First value or the value itself
 */
function getFirst(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Get text content from content property
 * @param {Array} content - Content property array
 * @returns {string} Text content
 */
function getContentText(content) {
  const first = getFirst(content);
  if (typeof first === "object") {
    return first.value || first.text || "";
  }
  return first || "";
}
