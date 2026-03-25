/**
 * Timeline item cleanup and retention
 * @module storage/items-retention
 */

import { getCollection } from "./items.js";

// Maximum number of full read items to keep per channel before stripping content.
const MAX_FULL_READ_ITEMS = 200;

// Maximum age (in days) for stripped skeletons and unread items.
// After this period, both are hard-deleted to prevent unbounded growth.
const MAX_ITEM_AGE_DAYS = 30;

/**
 * Cleanup all read items across all channels (startup cleanup).
 * RSS items are stripped to dedup skeletons; AP items are hard-deleted.
 * @param {object} application - Indiekit application
 * @returns {Promise<number>} Total number of items cleaned up
 */
export async function cleanupAllReadItems(application) {
  const collection = getCollection(application);
  const channelsCollection = application.collections.get("microsub_channels");

  const channels = await channelsCollection.find({}).toArray();
  let totalCleaned = 0;

  for (const channel of channels) {
    const readByUsers = await collection.distinct("readBy", {
      channelId: channel._id,
      readBy: { $exists: true, $ne: [] },
    });

    for (const userId of readByUsers) {
      if (!userId) continue;

      const readCount = await collection.countDocuments({
        channelId: channel._id,
        readBy: userId,
        _stripped: { $ne: true },
      });

      if (readCount > MAX_FULL_READ_ITEMS) {
        const itemsToCleanup = await collection
          .find({
            channelId: channel._id,
            readBy: userId,
            _stripped: { $ne: true },
          })
          .sort({ published: -1, _id: -1 })
          .skip(MAX_FULL_READ_ITEMS)
          .project({ _id: 1, feedId: 1 })
          .toArray();

        if (itemsToCleanup.length > 0) {
          const apItemIds = [];
          const rssItemIds = [];
          for (const item of itemsToCleanup) {
            if (item.feedId) {
              rssItemIds.push(item._id);
            } else {
              apItemIds.push(item._id);
            }
          }

          // Hard-delete AP items
          if (apItemIds.length > 0) {
            const deleted = await collection.deleteMany({
              _id: { $in: apItemIds },
            });
            totalCleaned += deleted.deletedCount;
            console.info(
              `[Microsub] Startup cleanup: deleted ${deleted.deletedCount} AP items from channel "${channel.name}"`,
            );
          }

          // Strip RSS items to skeletons
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
            totalCleaned += stripped.modifiedCount;
            console.info(
              `[Microsub] Startup cleanup: stripped ${stripped.modifiedCount} RSS items from channel "${channel.name}"`,
            );
          }
        }
      }
    }
  }

  if (totalCleaned > 0) {
    console.info(
      `[Microsub] Startup cleanup complete: ${totalCleaned} total items cleaned`,
    );
  }

  return totalCleaned;
}

/**
 * Delete stale items: stripped skeletons and unread items older than MAX_ITEM_AGE_DAYS.
 * Stripped skeletons have served their dedup purpose; stale unread items are unlikely
 * to be read. Both are hard-deleted to prevent unbounded collection growth.
 * @param {object} application - Indiekit application
 * @returns {Promise<number>} Total number of items deleted
 */
export async function cleanupStaleItems(application) {
  const collection = getCollection(application);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_ITEM_AGE_DAYS);

  // Delete stripped skeletons older than cutoff
  const strippedResult = await collection.deleteMany({
    _stripped: true,
    $or: [
      { published: { $lt: cutoff } },
      { published: { $exists: false }, createdAt: { $lt: cutoff.toISOString() } },
    ],
  });

  // Delete unread items older than cutoff
  const unreadResult = await collection.deleteMany({
    readBy: { $in: [null, []] },
    _stripped: { $ne: true },
    $or: [
      { published: { $lt: cutoff } },
      { published: { $exists: false }, createdAt: { $lt: cutoff.toISOString() } },
    ],
  });

  // Also catch items with no readBy field at all
  const noReadByResult = await collection.deleteMany({
    readBy: { $exists: false },
    _stripped: { $ne: true },
    $or: [
      { published: { $lt: cutoff } },
      { published: { $exists: false }, createdAt: { $lt: cutoff.toISOString() } },
    ],
  });

  const total =
    strippedResult.deletedCount +
    unreadResult.deletedCount +
    noReadByResult.deletedCount;

  if (total > 0) {
    console.info(
      `[Microsub] Stale cleanup: deleted ${strippedResult.deletedCount} stripped skeletons, ` +
        `${unreadResult.deletedCount + noReadByResult.deletedCount} stale unread items ` +
        `(cutoff: ${MAX_ITEM_AGE_DAYS} days)`,
    );
  }

  return total;
}
