/**
 * Read state tracking utilities
 * @module storage/read-state
 */

import { markItemsRead, markItemsUnread, getUnreadCount } from "./items.js";

/**
 * Mark entries as read for a user
 * @param {object} application - Indiekit application
 * @param {string} channelUid - Channel UID
 * @param {Array} entries - Entry IDs to mark as read
 * @param {string} userId - User ID
 * @returns {Promise<number>} Number of entries marked
 */
export async function markRead(application, channelUid, entries, userId) {
  const channelsCollection = application.collections.get("microsub_channels");
  const channel = await channelsCollection.findOne({ uid: channelUid });

  if (!channel) {
    return 0;
  }

  return markItemsRead(application, channel._id, entries, userId);
}

/**
 * Mark entries as unread for a user
 * @param {object} application - Indiekit application
 * @param {string} channelUid - Channel UID
 * @param {Array} entries - Entry IDs to mark as unread
 * @param {string} userId - User ID
 * @returns {Promise<number>} Number of entries marked
 */
export async function markUnread(application, channelUid, entries, userId) {
  const channelsCollection = application.collections.get("microsub_channels");
  const channel = await channelsCollection.findOne({ uid: channelUid });

  if (!channel) {
    return 0;
  }

  return markItemsUnread(application, channel._id, entries, userId);
}

/**
 * Get unread count for a channel
 * @param {object} application - Indiekit application
 * @param {string} channelUid - Channel UID
 * @param {string} userId - User ID
 * @returns {Promise<number>} Unread count
 */
export async function getChannelUnreadCount(application, channelUid, userId) {
  const channelsCollection = application.collections.get("microsub_channels");
  const channel = await channelsCollection.findOne({ uid: channelUid });

  if (!channel) {
    return 0;
  }

  return getUnreadCount(application, channel._id, userId);
}

/**
 * Get unread counts for all channels
 * @param {object} application - Indiekit application
 * @param {string} userId - User ID
 * @returns {Promise<Map>} Map of channel UID to unread count
 */
export async function getAllUnreadCounts(application, userId) {
  const channelsCollection = application.collections.get("microsub_channels");
  const itemsCollection = application.collections.get("microsub_items");

  // Aggregate unread counts per channel
  const pipeline = [
    {
      $match: {
        readBy: { $ne: userId },
      },
    },
    {
      $group: {
        _id: "$channelId",
        count: { $sum: 1 },
      },
    },
  ];

  const results = await itemsCollection.aggregate(pipeline).toArray();

  // Get channel UIDs
  const channelIds = results.map((r) => r._id);
  const channels = await channelsCollection
    .find({ _id: { $in: channelIds } })
    .toArray();

  const channelMap = new Map(channels.map((c) => [c._id.toString(), c.uid]));

  // Build result map
  const unreadCounts = new Map();
  for (const result of results) {
    const uid = channelMap.get(result._id.toString());
    if (uid) {
      unreadCounts.set(uid, result.count);
    }
  }

  return unreadCounts;
}
