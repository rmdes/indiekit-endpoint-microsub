/**
 * Timeline item search
 * @module storage/items-search
 */

import { ObjectId } from "mongodb";

import { getCollection, transformToJf2 } from "./items.js";

/**
 * Search items by text
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {string} query - Search query
 * @param {number} [limit] - Max results
 * @returns {Promise<Array>} Array of matching items
 */
export async function searchItems(application, channelId, query, limit = 20) {
  const collection = getCollection(application);
  const objectId =
    typeof channelId === "string" ? new ObjectId(channelId) : channelId;

  // Use MongoDB text index for efficient full-text search
  const items = await collection
    .find({
      channelId: objectId,
      $text: { $search: query },
    })
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .toArray();

  return items.map((item) => transformToJf2(item));
}
