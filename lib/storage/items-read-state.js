/**
 * Timeline item read state management
 * @module storage/items-read-state
 */

import { ObjectId } from "mongodb";

import { UNREAD_RETENTION_DAYS } from "../utils/constants.js";
import { getCollection } from "./items.js";

// Maximum number of full read items to keep per channel before stripping content.
// Items beyond this limit are converted to lightweight dedup skeletons (channelId,
// uid, readBy) so the poller doesn't re-ingest them as new unread entries.
const MAX_FULL_READ_ITEMS = 200;

/**
 * Cleanup old read items by stripping content but preserving dedup skeletons.
 * This prevents the vicious cycle where deleted read items get re-ingested as
 * unread by the poller because the dedup record (channelId + uid) was destroyed.
 *
 * AP items (feedId: null) are hard-deleted instead of stripped, since no poller
 * re-ingests them — they arrive via inbox push and don't need dedup skeletons.
 *
 * @param {object} collection - MongoDB collection
 * @param {ObjectId} channelObjectId - Channel ObjectId
 * @param {string} userId - User ID
 */
async function cleanupOldReadItems(collection, channelObjectId, userId) {
  const readCount = await collection.countDocuments({
    channelId: channelObjectId,
    readBy: userId,
  });

  if (readCount > MAX_FULL_READ_ITEMS) {
    // Find old read items beyond the retention limit
    const itemsToCleanup = await collection
      .find({
        channelId: channelObjectId,
        readBy: userId,
        _stripped: { $ne: true },
      })
      .sort({ published: -1, _id: -1 })
      .skip(MAX_FULL_READ_ITEMS)
      .project({ _id: 1, feedId: 1 })
      .toArray();

    if (itemsToCleanup.length === 0) return;

    // Separate AP items (feedId: null) from RSS items (feedId: ObjectId)
    const apItemIds = [];
    const rssItemIds = [];
    for (const item of itemsToCleanup) {
      if (item.feedId) {
        rssItemIds.push(item._id);
      } else {
        apItemIds.push(item._id);
      }
    }

    // Hard-delete AP items — no poller to re-ingest, skeletons are useless
    if (apItemIds.length > 0) {
      const deleted = await collection.deleteMany({
        _id: { $in: apItemIds },
      });
      console.info(
        `[Microsub] Deleted ${deleted.deletedCount} old AP read items`,
      );
    }

    // Strip RSS items to dedup skeletons — poller would re-ingest if deleted
    if (rssItemIds.length > 0) {
      const stripped = await collection.updateMany(
        { _id: { $in: rssItemIds } },
        {
          $set: { _stripped: true },
          $unset: {
            name: "",
            content: "",
            summary: "",
            author: "",
            category: "",
            photo: "",
            video: "",
            audio: "",
            likeOf: "",
            repostOf: "",
            bookmarkOf: "",
            inReplyTo: "",
            source: "",
          },
        },
      );
      console.info(
        `[Microsub] Stripped ${stripped.modifiedCount} old RSS read items (keeping ${MAX_FULL_READ_ITEMS} full)`,
      );
    }
  }
}

/**
 * Mark items as read
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {Array} entryIds - Array of entry IDs to mark as read (can be ObjectId, uid, or URL)
 * @param {string} userId - User ID
 * @returns {Promise<number>} Number of items updated
 */
export async function markItemsRead(application, channelId, entryIds, userId) {
  const collection = getCollection(application);
  const channelObjectId =
    typeof channelId === "string" ? new ObjectId(channelId) : channelId;

  console.info(
    `[Microsub] markItemsRead called for channel ${channelId}, entries:`,
    entryIds,
    `userId: ${userId}`,
  );

  // Handle "last-read-entry" special value
  if (entryIds.includes("last-read-entry")) {
    // Mark all items in channel as read
    const result = await collection.updateMany(
      { channelId: channelObjectId },
      { $addToSet: { readBy: userId } },
    );
    console.info(
      `[Microsub] Marked all items as read: ${result.modifiedCount} updated`,
    );

    // Cleanup old read items, keeping only the most recent
    await cleanupOldReadItems(collection, channelObjectId, userId);

    return result.modifiedCount;
  }

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

  // Build query to match by _id, uid, or url (Microsub spec uses URLs as entry identifiers)
  const result = await collection.updateMany(
    {
      channelId: channelObjectId,
      $or: [
        ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
        { uid: { $in: entryIds } },
        { url: { $in: entryIds } },
      ],
    },
    { $addToSet: { readBy: userId } },
  );

  console.info(
    `[Microsub] markItemsRead result: ${result.modifiedCount} items updated`,
  );

  return result.modifiedCount;
}

/**
 * Mark all items from a specific feed as read in a channel
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {ObjectId|string} feedId - Feed ObjectId
 * @param {string} userId - User ID
 * @returns {Promise<number>} Number of items updated
 */
export async function markFeedItemsRead(
  application,
  channelId,
  feedId,
  userId,
) {
  const collection = getCollection(application);
  const channelObjectId =
    typeof channelId === "string" ? new ObjectId(channelId) : channelId;
  const feedObjectId =
    typeof feedId === "string" ? new ObjectId(feedId) : feedId;

  const result = await collection.updateMany(
    { channelId: channelObjectId, feedId: feedObjectId },
    { $addToSet: { readBy: userId } },
  );

  console.info(
    `[Microsub] markFeedItemsRead: marked ${result.modifiedCount} items from feed ${feedId} as read`,
  );

  // Cleanup old read items
  await cleanupOldReadItems(collection, channelObjectId, userId);

  return result.modifiedCount;
}

/**
 * Mark items as unread
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {Array} entryIds - Array of entry IDs to mark as unread (can be ObjectId, uid, or URL)
 * @param {string} userId - User ID
 * @returns {Promise<number>} Number of items updated
 */
export async function markItemsUnread(
  application,
  channelId,
  entryIds,
  userId,
) {
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
  const result = await collection.updateMany(
    {
      channelId: channelObjectId,
      $or: [
        ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
        { uid: { $in: entryIds } },
        { url: { $in: entryIds } },
      ],
    },
    { $pull: { readBy: userId } },
  );

  return result.modifiedCount;
}

/**
 * Count read items in a channel
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {string} userId - User ID
 * @returns {Promise<number>} Number of read items
 */
export async function countReadItems(application, channelId, userId) {
  const collection = getCollection(application);
  const objectId =
    typeof channelId === "string" ? new ObjectId(channelId) : channelId;

  return collection.countDocuments({
    channelId: objectId,
    readBy: userId,
  });
}

/**
 * Get unread count for a channel
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {string} userId - User ID
 * @returns {Promise<number>} Unread count
 */
export async function getUnreadCount(application, channelId, userId) {
  const collection = getCollection(application);
  const objectId =
    typeof channelId === "string" ? new ObjectId(channelId) : channelId;

  // Only count items from the last UNREAD_RETENTION_DAYS, exclude stripped skeletons
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - UNREAD_RETENTION_DAYS);

  return collection.countDocuments({
    channelId: objectId,
    readBy: { $ne: userId },
    published: { $gte: cutoffDate },
    _stripped: { $ne: true },
  });
}
