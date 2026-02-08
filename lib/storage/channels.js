/**
 * Channel storage operations
 * @module storage/channels
 */

import { ObjectId } from "mongodb";

import { generateChannelUid } from "../utils/jf2.js";

import { deleteFeedsForChannel } from "./feeds.js";
import { deleteItemsForChannel } from "./items.js";

/**
 * Get channels collection from application
 * @param {object} application - Indiekit application
 * @returns {object} MongoDB collection
 */
function getCollection(application) {
  return application.collections.get("microsub_channels");
}

/**
 * Get items collection for unread counts
 * @param {object} application - Indiekit application
 * @returns {object} MongoDB collection
 */
function getItemsCollection(application) {
  return application.collections.get("microsub_items");
}

/**
 * Create a new channel
 * @param {object} application - Indiekit application
 * @param {object} data - Channel data
 * @param {string} data.name - Channel name
 * @param {string} [data.userId] - User ID
 * @returns {Promise<object>} Created channel
 */
export async function createChannel(application, { name, userId }) {
  const collection = getCollection(application);

  // Generate unique UID with retry on collision
  let uid;
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    uid = generateChannelUid();
    const existing = await collection.findOne({ uid });
    if (!existing) break;
    attempts++;
  }

  if (attempts >= maxAttempts) {
    throw new Error("Failed to generate unique channel UID");
  }

  // Get max order for user
  const maxOrderResult = await collection
    .find({ userId })
    // eslint-disable-next-line unicorn/no-array-sort -- MongoDB cursor method, not Array#sort
    .sort({ order: -1 })
    .limit(1)
    .toArray();

  const order = maxOrderResult.length > 0 ? maxOrderResult[0].order + 1 : 0;

  const channel = {
    uid,
    name,
    userId,
    order,
    settings: {
      excludeTypes: [],
      excludeRegex: undefined,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await collection.insertOne(channel);

  return channel;
}

// Retention period for unread count (only count recent items)
const UNREAD_RETENTION_DAYS = 30;

/**
 * Get all channels for a user
 * @param {object} application - Indiekit application
 * @param {string} [userId] - User ID (optional for single-user mode)
 * @returns {Promise<Array>} Array of channels with unread counts
 */
export async function getChannels(application, userId) {
  const collection = getCollection(application);
  const itemsCollection = getItemsCollection(application);

  const filter = userId ? { userId } : {};
  const channels = await collection
    // eslint-disable-next-line unicorn/no-array-callback-reference -- filter is MongoDB query object
    .find(filter)
    // eslint-disable-next-line unicorn/no-array-sort -- MongoDB cursor method, not Array#sort
    .sort({ order: 1 })
    .toArray();

  // Calculate cutoff date for unread counts (only count recent items)
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - UNREAD_RETENTION_DAYS);

  // Get unread counts for each channel (only recent items)
  const channelsWithCounts = await Promise.all(
    channels.map(async (channel) => {
      const unreadCount = await itemsCollection.countDocuments({
        channelId: channel._id,
        readBy: { $ne: userId },
        published: { $gte: cutoffDate },
      });

      return {
        uid: channel.uid,
        name: channel.name,
        unread: unreadCount > 0 ? unreadCount : false,
      };
    }),
  );

  // Always include notifications channel first
  const notificationsChannel = channelsWithCounts.find(
    (c) => c.uid === "notifications",
  );
  const otherChannels = channelsWithCounts.filter(
    (c) => c.uid !== "notifications",
  );

  if (notificationsChannel) {
    return [notificationsChannel, ...otherChannels];
  }

  return channelsWithCounts;
}

/**
 * Get a single channel by UID
 * @param {object} application - Indiekit application
 * @param {string} uid - Channel UID
 * @param {string} [userId] - User ID
 * @returns {Promise<object|null>} Channel or null
 */
export async function getChannel(application, uid, userId) {
  const collection = getCollection(application);
  const query = { uid };
  if (userId) query.userId = userId;

  return collection.findOne(query);
}

/**
 * Get channel by MongoDB ObjectId
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} id - Channel ObjectId
 * @returns {Promise<object|null>} Channel or null
 */
export async function getChannelById(application, id) {
  const collection = getCollection(application);
  const objectId = typeof id === "string" ? new ObjectId(id) : id;
  return collection.findOne({ _id: objectId });
}

/**
 * Update a channel
 * @param {object} application - Indiekit application
 * @param {string} uid - Channel UID
 * @param {object} updates - Fields to update
 * @param {string} [userId] - User ID
 * @returns {Promise<object|null>} Updated channel
 */
export async function updateChannel(application, uid, updates, userId) {
  const collection = getCollection(application);
  const query = { uid };
  if (userId) query.userId = userId;

  const result = await collection.findOneAndUpdate(
    query,
    {
      $set: {
        ...updates,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );

  return result;
}

/**
 * Delete a channel and all its feeds and items
 * @param {object} application - Indiekit application
 * @param {string} uid - Channel UID
 * @param {string} [userId] - User ID
 * @returns {Promise<boolean>} True if deleted
 */
export async function deleteChannel(application, uid, userId) {
  const collection = getCollection(application);
  const query = { uid };
  if (userId) query.userId = userId;

  // Don't allow deleting notifications channel
  if (uid === "notifications") {
    return false;
  }

  // Find the channel first to get its ObjectId
  const channel = await collection.findOne(query);
  if (!channel) {
    return false;
  }

  // Cascade delete: items first, then feeds, then channel
  const itemsDeleted = await deleteItemsForChannel(application, channel._id);
  const feedsDeleted = await deleteFeedsForChannel(application, channel._id);
  console.info(
    `[Microsub] Deleted channel ${uid}: ${feedsDeleted} feeds, ${itemsDeleted} items`,
  );

  const result = await collection.deleteOne({ _id: channel._id });
  return result.deletedCount > 0;
}

/**
 * Reorder channels
 * @param {object} application - Indiekit application
 * @param {Array} channelUids - Ordered array of channel UIDs
 * @param {string} [userId] - User ID
 * @returns {Promise<void>}
 */
export async function reorderChannels(application, channelUids, userId) {
  const collection = getCollection(application);

  // Update order for each channel
  const operations = channelUids.map((uid, index) => ({
    updateOne: {
      filter: userId ? { uid, userId } : { uid },
      update: { $set: { order: index, updatedAt: new Date() } },
    },
  }));

  if (operations.length > 0) {
    await collection.bulkWrite(operations);
  }
}

/**
 * Update channel settings
 * @param {object} application - Indiekit application
 * @param {string} uid - Channel UID
 * @param {object} settings - Settings to update
 * @param {Array} [settings.excludeTypes] - Types to exclude
 * @param {string} [settings.excludeRegex] - Regex pattern to exclude
 * @param {string} [userId] - User ID
 * @returns {Promise<object|null>} Updated channel
 */
export async function updateChannelSettings(
  application,
  uid,
  settings,
  userId,
) {
  return updateChannel(application, uid, { settings }, userId);
}

/**
 * Ensure notifications channel exists
 * @param {object} application - Indiekit application
 * @param {string} [userId] - User ID
 * @returns {Promise<object>} Notifications channel
 */
export async function ensureNotificationsChannel(application, userId) {
  const collection = getCollection(application);

  const existing = await collection.findOne({
    uid: "notifications",
    ...(userId && { userId }),
  });

  if (existing) {
    return existing;
  }

  // Create notifications channel
  const channel = {
    uid: "notifications",
    name: "Notifications",
    userId,
    order: -1, // Always first
    settings: {
      excludeTypes: [],
      excludeRegex: undefined,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await collection.insertOne(channel);
  return channel;
}
