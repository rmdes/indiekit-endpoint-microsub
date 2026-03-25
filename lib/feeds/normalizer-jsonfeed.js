/**
 * JSON Feed normalization
 * @module feeds/normalizer-jsonfeed
 */

import {
  generateItemUid,
  extractImagesFromHtml,
  sanitizeHtml,
  SANITIZE_OPTIONS,
} from "./normalizer.js";

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
    name: item.title
      ? sanitizeHtml(item.title, { allowedTags: [] }).trim()
      : undefined,
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
 * Normalize JSON Feed metadata
 * @param {object} feed - JSON Feed object
 * @param {string} feedUrl - Feed URL
 * @returns {object} Normalized feed metadata
 */
export function normalizeJsonFeedMeta(feed, feedUrl) {
  const normalized = {
    name: feed.title
      ? sanitizeHtml(feed.title, { allowedTags: [] }).trim()
      : feedUrl,
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
