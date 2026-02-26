/**
 * Deck configuration storage
 * @module storage/deck
 */

import { ObjectId } from "mongodb";

/**
 * Get deck config collection
 * @param {object} application - Indiekit application
 * @returns {object} MongoDB collection
 */
function getCollection(application) {
  return application.collections.get("microsub_deck_config");
}

/**
 * Get deck configuration for a user
 * @param {object} application - Indiekit application
 * @param {string} userId - User ID
 * @returns {Promise<object|null>} Deck config or null
 */
export async function getDeckConfig(application, userId) {
  const collection = getCollection(application);
  return collection.findOne({ userId });
}

/**
 * Save deck configuration
 * @param {object} application - Indiekit application
 * @param {string} userId - User ID
 * @param {Array<string>} channelIds - Ordered array of channel ObjectId strings
 * @returns {Promise<void>}
 */
export async function saveDeckConfig(application, userId, channelIds) {
  const collection = getCollection(application);
  const columns = channelIds.map((id, order) => ({
    channelId: new ObjectId(id),
    order,
  }));

  await collection.updateOne(
    { userId },
    {
      $set: {
        columns,
        updatedAt: new Date().toISOString(),
      },
      $setOnInsert: {
        userId,
        createdAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
}
