/**
 * Timeline item storage operations — core CRUD
 * @module storage/items
 */

import { ObjectId } from "mongodb";

import { extractImagesFromHtml } from "../utils/html.js";
import {
  buildPaginationQuery,
  buildPaginationSort,
  generatePagingCursors,
  parseLimit,
} from "../utils/pagination.js";

/**
 * Get items collection from application
 * @param {object} application - Indiekit application
 * @returns {object} MongoDB collection
 */
export function getCollection(application) {
  return application.collections.get("microsub_items");
}

/**
 * Extract URL string from a media value
 * @param {object|string} media - Media value (can be string URL or object)
 * @returns {string|undefined} URL string
 */
function extractMediaUrl(media) {
  if (!media) {
    return;
  }
  if (typeof media === "string") {
    return media;
  }
  if (typeof media === "object") {
    return media.value || media.url || media.src;
  }
}

/**
 * Normalize media array to URL strings
 * @param {Array} mediaArray - Array of media items
 * @returns {Array} Array of URL strings
 */
function normalizeMediaArray(mediaArray) {
  if (!mediaArray || !Array.isArray(mediaArray)) {
    return [];
  }
  return mediaArray.map((media) => extractMediaUrl(media)).filter(Boolean);
}

/**
 * Normalize author object to ensure photo is a URL string
 * @param {object} author - Author object
 * @returns {object} Normalized author
 */
function normalizeAuthor(author) {
  if (!author) {
    return;
  }
  return {
    ...author,
    photo: extractMediaUrl(author.photo),
  };
}

/**
 * Transform database item to jf2 format
 * @param {object} item - Database item
 * @param {string} [userId] - User ID for read state
 * @returns {object} jf2 item
 */
export function transformToJf2(item, userId) {
  const jf2 = {
    type: item.type,
    uid: item.uid,
    url: item.url,
    published: item.published?.toISOString(), // Convert Date to ISO string
    _id: item._id.toString(),
    _is_read: userId ? item.readBy?.includes(userId) : false,
    _channelId: item.channelId?.toString(),
    _feedId: item.feedId?.toString(),
  };

  // Optional fields
  if (item.name) jf2.name = item.name;
  if (item.content) jf2.content = item.content;
  if (item.summary) jf2.summary = item.summary;
  if (item.updated) jf2.updated = item.updated.toISOString(); // Convert Date to ISO string
  if (item.author) jf2.author = normalizeAuthor(item.author);
  if (item.category?.length > 0) jf2.category = item.category;

  // Normalize media arrays to ensure they contain URL strings
  const photos = normalizeMediaArray(item.photo);
  const videos = normalizeMediaArray(item.video);
  const audios = normalizeMediaArray(item.audio);

  // Fallback: extract images from HTML content if no explicit photos
  if (photos.length === 0 && item.content?.html) {
    const extracted = extractImagesFromHtml(item.content.html);
    if (extracted.length > 0) {
      photos.push(...extracted);
    }
  }

  if (photos.length > 0) jf2.photo = photos;
  if (videos.length > 0) jf2.video = videos;
  if (audios.length > 0) jf2.audio = audios;

  // Interaction types
  if (item.likeOf?.length > 0) jf2["like-of"] = item.likeOf;
  if (item.repostOf?.length > 0) jf2["repost-of"] = item.repostOf;
  if (item.bookmarkOf?.length > 0) jf2["bookmark-of"] = item.bookmarkOf;
  if (item.inReplyTo?.length > 0) jf2["in-reply-to"] = item.inReplyTo;

  // Source
  if (item.source) jf2._source = item.source;

  return jf2;
}

/**
 * Add an item to a channel
 * @param {object} application - Indiekit application
 * @param {object} data - Item data
 * @param {ObjectId} data.channelId - Channel ObjectId
 * @param {ObjectId} data.feedId - Feed ObjectId
 * @param {string} data.uid - Unique item identifier
 * @param {object} data.item - jf2 item data
 * @returns {Promise<object|null>} Created item or null if duplicate
 */
export async function addItem(application, { channelId, feedId, uid, item }) {
  const collection = getCollection(application);

  const document = {
    channelId,
    feedId,
    uid,
    type: item.type || "entry",
    url: item.url,
    name: item.name || undefined,
    content: item.content || undefined,
    summary: item.summary || undefined,
    published: item.published ? new Date(item.published) : new Date(), // Keep as Date for query compatibility
    updated: item.updated ? new Date(item.updated) : undefined, // Keep as Date for query compatibility
    author: item.author || undefined,
    category: item.category || [],
    photo: item.photo || [],
    video: item.video || [],
    audio: item.audio || [],
    likeOf: item["like-of"] || item.likeOf || [],
    repostOf: item["repost-of"] || item.repostOf || [],
    bookmarkOf: item["bookmark-of"] || item.bookmarkOf || [],
    inReplyTo: item["in-reply-to"] || item.inReplyTo || [],
    source: item._source || undefined,
    readBy: [], // Array of user IDs who have read this item
    createdAt: new Date().toISOString(),
  };

  try {
    await collection.insertOne(document);
    return document;
  } catch (error) {
    // Duplicate key error (unique index on channelId + uid) — expected for dedup
    if (error.code === 11000) return;
    throw error;
  }
}

/**
 * Get timeline items for a channel
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {object} options - Query options
 * @param {string} [options.before] - Before cursor
 * @param {string} [options.after] - After cursor
 * @param {number} [options.limit] - Items per page
 * @param {string} [options.userId] - User ID for read state
 * @param {boolean} [options.showRead] - Whether to show read items (default: false)
 * @returns {Promise<object>} Timeline with items and paging
 */
export async function getTimelineItems(application, channelId, options = {}) {
  const collection = getCollection(application);
  const objectId =
    typeof channelId === "string" ? new ObjectId(channelId) : channelId;
  const limit = parseLimit(options.limit);

  // Base query - filter out read items unless showRead is true,
  // and always exclude stripped dedup skeletons (no content to display)
  const baseQuery = { channelId: objectId, _stripped: { $ne: true } };
  if (options.userId && !options.showRead) {
    baseQuery.readBy = { $ne: options.userId };
  }

  const query = buildPaginationQuery({
    before: options.before,
    after: options.after,
    baseQuery,
  });

  const sort = buildPaginationSort(options.before);

  // Fetch one extra to check if there are more
  const items = await collection
    // eslint-disable-next-line unicorn/no-array-callback-reference -- query is MongoDB query object
    .find(query)
    // eslint-disable-next-line unicorn/no-array-sort -- MongoDB cursor method, not Array#sort
    .sort(sort)
    .limit(limit + 1)
    .toArray();

  const hasMore = items.length > limit;
  if (hasMore) {
    items.pop();
  }

  // Transform to jf2 format
  const jf2Items = items.map((item) => transformToJf2(item, options.userId));

  // Generate paging cursors
  const paging = generatePagingCursors(items, limit, hasMore, options.before);

  return {
    items: jf2Items,
    paging,
  };
}

/**
 * Get timeline items across ALL channels, sorted chronologically
 * @param {object} application - Indiekit application
 * @param {object} options - Query options
 * @param {string} [options.before] - Before cursor
 * @param {string} [options.after] - After cursor
 * @param {number} [options.limit] - Items per page
 * @param {string} [options.userId] - User ID for read state
 * @param {boolean} [options.showRead] - Include read items
 * @param {Array<string>} [options.excludeChannelIds] - Channel IDs to exclude
 * @returns {Promise<object>} { items, paging }
 */
export async function getAllTimelineItems(application, options = {}) {
  const collection = getCollection(application);
  const limit = parseLimit(options.limit);

  // Base query - no channelId filter (cross-channel)
  const baseQuery = { _stripped: { $ne: true } };

  if (options.userId && !options.showRead) {
    baseQuery.readBy = { $ne: options.userId };
  }

  // Exclude specific channels if requested
  if (options.excludeChannelIds?.length > 0) {
    baseQuery.channelId = {
      $nin: options.excludeChannelIds.map(
        (id) => (typeof id === "string" ? new ObjectId(id) : id),
      ),
    };
  }

  const query = buildPaginationQuery({
    before: options.before,
    after: options.after,
    baseQuery,
  });

  const sort = buildPaginationSort(options.before);

  const items = await collection
    // eslint-disable-next-line unicorn/no-array-callback-reference -- query is MongoDB query object
    .find(query)
    // eslint-disable-next-line unicorn/no-array-sort -- MongoDB cursor method, not Array#sort
    .sort(sort)
    .limit(limit + 1)
    .toArray();

  const hasMore = items.length > limit;
  if (hasMore) {
    items.pop();
  }

  const jf2Items = items.map((item) => transformToJf2(item, options.userId));

  const paging = generatePagingCursors(items, limit, hasMore, options.before);

  return {
    items: jf2Items,
    paging,
  };
}

/**
 * Get an item by ID (MongoDB _id or uid)
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} id - Item ObjectId or uid string
 * @param {string} [userId] - User ID for read state
 * @returns {Promise<object|undefined>} jf2 item or undefined
 */
export async function getItemById(application, id, userId) {
  const collection = getCollection(application);

  let item;

  // Try MongoDB ObjectId first
  try {
    const objectId = typeof id === "string" ? new ObjectId(id) : id;
    item = await collection.findOne({ _id: objectId });
  } catch {
    // Invalid ObjectId format, will try uid lookup
  }

  // If not found by _id, try uid
  if (!item) {
    item = await collection.findOne({ uid: id });
  }

  if (!item) {
    return;
  }

  return transformToJf2(item, userId);
}

/**
 * Get items by UIDs
 * @param {object} application - Indiekit application
 * @param {Array} uids - Array of item UIDs
 * @param {string} [userId] - User ID for read state
 * @returns {Promise<Array>} Array of jf2 items
 */
export async function getItemsByUids(application, uids, userId) {
  const collection = getCollection(application);

  const items = await collection.find({ uid: { $in: uids } }).toArray();
  return items.map((item) => transformToJf2(item, userId));
}

/**
 * Remove items from channel
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {Array} entryIds - Array of entry IDs to remove (can be ObjectId, uid, or URL)
 * @returns {Promise<number>} Number of items removed
 */
export async function removeItems(application, channelId, entryIds) {
  const collection = getCollection(application);
  const channelObjectId =
    typeof channelId === "string" ? new ObjectId(channelId) : channelId;

  // Convert string IDs to ObjectIds where possible
  const objectIds = entryIds
    .map((id) => {
      try {
        return new ObjectId(id);
      } catch {
        return;
      }
    })
    .filter(Boolean);

  // Match by _id, uid, or url
  const result = await collection.deleteMany({
    channelId: channelObjectId,
    $or: [
      ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
      { uid: { $in: entryIds } },
      { url: { $in: entryIds } },
    ],
  });

  return result.deletedCount;
}

/**
 * Delete all items for a channel
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @returns {Promise<number>} Number of deleted items
 */
export async function deleteItemsForChannel(application, channelId) {
  const collection = getCollection(application);
  const objectId =
    typeof channelId === "string" ? new ObjectId(channelId) : channelId;

  const result = await collection.deleteMany({ channelId: objectId });
  return result.deletedCount;
}

/**
 * Delete items for a specific feed
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} feedId - Feed ObjectId
 * @returns {Promise<number>} Number of deleted items
 */
export async function deleteItemsForFeed(application, feedId) {
  const collection = getCollection(application);
  const objectId = typeof feedId === "string" ? new ObjectId(feedId) : feedId;

  const result = await collection.deleteMany({ feedId: objectId });
  return result.deletedCount;
}

/**
 * Delete items by author URL (for blocking)
 * @param {object} application - Indiekit application
 * @param {string} userId - User ID (for filtering user's channels)
 * @param {string} authorUrl - Author URL to delete items from
 * @returns {Promise<number>} Number of deleted items
 */
export async function deleteItemsByAuthorUrl(application, userId, authorUrl) {
  const collection = getCollection(application);
  const channelsCollection = application.collections.get("microsub_channels");

  // Get all channel IDs for this user
  const userChannels = await channelsCollection.find({ userId }).toArray();
  const channelIds = userChannels.map((c) => c._id);

  // Delete all items from blocked author in user's channels
  const result = await collection.deleteMany({
    channelId: { $in: channelIds },
    "author.url": authorUrl,
  });

  return result.deletedCount;
}

/**
 * Create indexes for efficient queries
 * @param {object} application - Indiekit application
 * @returns {Promise<void>}
 */
export async function createIndexes(application) {
  const collection = getCollection(application);

  // Primary query indexes
  await collection.createIndex({ channelId: 1, published: -1 });
  await collection.createIndex({ channelId: 1, uid: 1 }, { unique: true });
  await collection.createIndex({ feedId: 1 });

  // URL matching index for mark_read operations
  await collection.createIndex({ channelId: 1, url: 1 });

  // Compound index for unread count aggregation (P7)
  await collection.createIndex({ channelId: 1, _stripped: 1, published: -1 });

  // Cross-channel timeline query index (P12)
  await collection.createIndex({ _stripped: 1, published: -1 });

  // Full-text search index with weights
  // Higher weight = more importance in relevance scoring
  await collection.createIndex(
    {
      name: "text",
      "content.text": "text",
      "content.html": "text",
      summary: "text",
      "author.name": "text",
    },
    {
      name: "text_search",
      weights: {
        name: 10, // Titles most important
        summary: 5, // Summaries second
        "content.text": 3, // Content third
        "content.html": 2, // HTML content lower
        "author.name": 1, // Author names lowest
      },
      default_language: "english",
    },
  );
}
