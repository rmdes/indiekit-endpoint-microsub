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
