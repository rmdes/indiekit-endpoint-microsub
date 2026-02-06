/**
 * jf2 utility functions for Microsub
 * @module utils/jf2
 */

import { createHash } from "node:crypto";

/**
 * Generate a unique ID for an item based on feed URL and item identifier
 * @param {string} feedUrl - Feed URL
 * @param {string} itemId - Item ID or URL
 * @returns {string} Unique item ID
 */
export function generateItemUid(feedUrl, itemId) {
  const input = `${feedUrl}:${itemId}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 24);
}

/**
 * Generate a random channel UID
 * @returns {string} 24-character random string
 */
export function generateChannelUid() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let index = 0; index < 24; index++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create a jf2 Item from normalized feed data
 * @param {object} data - Normalized item data
 * @param {object} source - Feed source metadata
 * @returns {object} jf2 Item object
 */
export function createJf2Item(data, source) {
  return {
    type: "entry",
    uid: data.uid,
    url: data.url,
    name: data.name || undefined,
    content: data.content || undefined,
    summary: data.summary || undefined,
    published: data.published,
    updated: data.updated || undefined,
    author: data.author || undefined,
    category: data.category || [],
    photo: data.photo || [],
    video: data.video || [],
    audio: data.audio || [],
    // Interaction types
    "like-of": data.likeOf || [],
    "repost-of": data.repostOf || [],
    "bookmark-of": data.bookmarkOf || [],
    "in-reply-to": data.inReplyTo || [],
    // Internal properties (prefixed with _)
    _id: data._id,
    _is_read: data._is_read || false,
    _source: source,
  };
}

/**
 * Create a jf2 Card (author/person)
 * @param {object} data - Author data
 * @returns {object} jf2 Card object
 */
export function createJf2Card(data) {
  if (!data) return;

  return {
    type: "card",
    name: data.name || undefined,
    url: data.url || undefined,
    photo: data.photo || undefined,
  };
}

/**
 * Create a jf2 Content object
 * @param {string} text - Plain text content
 * @param {string} html - HTML content
 * @returns {object|undefined} jf2 Content object
 */
export function createJf2Content(text, html) {
  if (!text && !html) return;

  return {
    text: text || stripHtml(html),
    html: html || undefined,
  };
}

/**
 * Strip HTML tags from string
 * @param {string} html - HTML string
 * @returns {string} Plain text
 */
export function stripHtml(html) {
  if (!html) return "";
  return html.replaceAll(/<[^>]*>/g, "").trim();
}

/**
 * Create a jf2 Feed response
 * @param {object} options - Feed options
 * @param {Array} options.items - Array of jf2 items
 * @param {object} options.paging - Pagination cursors
 * @returns {object} jf2 Feed object
 */
export function createJf2Feed({ items, paging }) {
  const feed = {
    items: items || [],
  };

  if (paging) {
    feed.paging = {};
    if (paging.before) feed.paging.before = paging.before;
    if (paging.after) feed.paging.after = paging.after;
  }

  return feed;
}

/**
 * Create a Channel response object
 * @param {object} channel - Channel data
 * @param {number} unreadCount - Number of unread items
 * @returns {object} Channel object for API response
 */
export function createChannelResponse(channel, unreadCount = 0) {
  return {
    uid: channel.uid,
    name: channel.name,
    unread: unreadCount > 0 ? unreadCount : false,
  };
}

/**
 * Create a Feed response object
 * @param {object} feed - Feed data
 * @returns {object} Feed object for API response
 */
export function createFeedResponse(feed) {
  return {
    type: "feed",
    url: feed.url,
    name: feed.title || undefined,
    photo: feed.photo || undefined,
  };
}

/**
 * Detect interaction type from item properties
 * @param {object} item - jf2 item
 * @returns {string|undefined} Interaction type
 */
export function detectInteractionType(item) {
  if (item["like-of"]?.length > 0 || item.likeOf?.length > 0) return "like";
  if (item["repost-of"]?.length > 0 || item.repostOf?.length > 0)
    return "repost";
  if (item["bookmark-of"]?.length > 0 || item.bookmarkOf?.length > 0)
    return "bookmark";
  if (item["in-reply-to"]?.length > 0 || item.inReplyTo?.length > 0)
    return "reply";
  if (item.checkin) return "checkin";
  return;
}
