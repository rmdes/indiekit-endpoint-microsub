/**
 * Search query module for full-text search
 * @module search/query
 */

import { ObjectId } from "mongodb";

/**
 * Search items using MongoDB text search
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {string} query - Search query string
 * @param {object} options - Search options
 * @param {number} [options.limit] - Max results (default 20)
 * @param {number} [options.skip] - Skip results for pagination
 * @param {boolean} [options.sortByScore] - Sort by relevance (default true)
 * @returns {Promise<Array>} Array of matching items
 */
export async function searchItemsFullText(
  application,
  channelId,
  query,
  options = {},
) {
  const collection = application.collections.get("microsub_items");
  const { limit = 20, skip = 0, sortByScore = true } = options;

  const channelObjectId =
    typeof channelId === "string" ? new ObjectId(channelId) : channelId;

  // Build the search query
  const searchQuery = {
    channelId: channelObjectId,
    $text: { $search: query },
  };

  // Build aggregation pipeline for scoring
  const pipeline = [
    { $match: searchQuery },
    { $addFields: { score: { $meta: "textScore" } } },
  ];

  if (sortByScore) {
    pipeline.push(
      { $sort: { score: -1, published: -1 } },
      { $skip: skip },
      { $limit: limit },
    );
  } else {
    pipeline.push(
      { $sort: { published: -1 } },
      { $skip: skip },
      { $limit: limit },
    );
  }

  const items = await collection.aggregate(pipeline).toArray();

  return items.map((item) => transformToSearchResult(item));
}

/**
 * Search items using regex fallback (for partial matching)
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {string} query - Search query string
 * @param {object} options - Search options
 * @returns {Promise<Array>} Array of matching items
 */
export async function searchItemsRegex(
  application,
  channelId,
  query,
  options = {},
) {
  const collection = application.collections.get("microsub_items");
  const { limit = 20 } = options;

  const channelObjectId =
    typeof channelId === "string" ? new ObjectId(channelId) : channelId;

  // Escape regex special characters
  const escapedQuery = query.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
  const regex = new RegExp(escapedQuery, "i");

  const items = await collection
    .find({
      channelId: channelObjectId,
      $or: [
        { name: regex },
        { "content.text": regex },
        { "content.html": regex },
        { summary: regex },
        { "author.name": regex },
      ],
    })
    // eslint-disable-next-line unicorn/no-array-sort -- MongoDB cursor method, not Array#sort
    .sort({ published: -1 })
    .limit(limit)
    .toArray();

  return items.map((item) => transformToSearchResult(item));
}

/**
 * Search with automatic fallback
 * Uses full-text search first, falls back to regex if no results
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {string} query - Search query string
 * @param {object} options - Search options
 * @returns {Promise<Array>} Array of matching items
 */
export async function searchWithFallback(
  application,
  channelId,
  query,
  options = {},
) {
  // Try full-text search first
  try {
    const results = await searchItemsFullText(
      application,
      channelId,
      query,
      options,
    );
    if (results.length > 0) {
      return results;
    }
  } catch {
    // Text index might not exist, fall through to regex
  }

  // Fall back to regex search
  return searchItemsRegex(application, channelId, query, options);
}

/**
 * Transform database item to search result format
 * @param {object} item - Database item
 * @returns {object} Search result
 */
function transformToSearchResult(item) {
  const result = {
    type: item.type || "entry",
    uid: item.uid,
    url: item.url,
    published: item.published?.toISOString(),
    _id: item._id.toString(),
  };

  if (item.name) result.name = item.name;
  if (item.content) result.content = item.content;
  if (item.summary) result.summary = item.summary;
  if (item.author) result.author = item.author;
  if (item.photo?.length > 0) result.photo = item.photo;
  if (item.score) result._score = item.score;

  return result;
}

/**
 * Get search suggestions (autocomplete)
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {string} prefix - Search prefix
 * @param {number} limit - Max suggestions
 * @returns {Promise<Array>} Array of suggestions
 */
export async function getSearchSuggestions(
  application,
  channelId,
  prefix,
  limit = 5,
) {
  const collection = application.collections.get("microsub_items");

  const channelObjectId =
    typeof channelId === "string" ? new ObjectId(channelId) : channelId;

  const escapedPrefix = prefix.replaceAll(
    /[$()*+.?[\\\]^{|}]/g,
    String.raw`\$&`,
  );
  const regex = new RegExp(`^${escapedPrefix}`, "i");

  // Get unique names/titles that match prefix
  const results = await collection
    .aggregate([
      { $match: { channelId: channelObjectId, name: regex } },
      { $group: { _id: "$name" } },
      { $limit: limit },
    ])
    .toArray();

  return results.map((r) => r._id).filter(Boolean);
}
