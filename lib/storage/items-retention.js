/**
 * Timeline item cleanup and retention
 * @module storage/items-retention
 */

import { MAX_FULL_READ_ITEMS } from "../utils/constants.js";
import { getCollection } from "./items.js";

// Global retention defaults. Each can be overridden per channel via
// channel.settings.{maxItems,maxItemsPerFeed,maxUnreadAgeDays}. The "notifications"
// channel is exempt from these caps entirely — webmentions are high-signal and
// users may want long history there.
export const DEFAULT_MAX_ITEMS = 1000;
export const DEFAULT_MAX_ITEMS_PER_FEED = 50;
export const DEFAULT_MAX_UNREAD_AGE_DAYS = 30;

/**
 * Cleanup all read items across all channels (startup cleanup).
 * Read items beyond MAX_FULL_READ_ITEMS are stripped to skeletons (kept for
 * dedup, content removed).
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
          .project({ _id: 1 })
          .toArray();

        if (itemsToCleanup.length > 0) {
          const ids = itemsToCleanup.map((item) => item._id);
          const stripped = await collection.updateMany(
            { _id: { $in: ids } },
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
            `[Microsub] Startup cleanup: stripped ${stripped.modifiedCount} items from channel "${channel.name}"`,
          );
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
 * Per-channel retention cleanup. For each channel (excluding `notifications`):
 *   1. Drop unread items + stripped skeletons older than `maxUnreadAgeDays`.
 *   2. Per-feed cap: keep most recent `maxItemsPerFeed` items per feed, drop the rest.
 *   3. Channel-wide cap: keep most recent `maxItems` items total, drop the rest.
 *
 * Each channel uses its own `channel.settings.{maxItems,maxItemsPerFeed,maxUnreadAgeDays}`
 * when present; otherwise the module-level defaults apply. This makes the policy
 * configurable per channel — a noisy aggregator channel can set tight caps while
 * a low-volume curated channel keeps a long tail.
 *
 * The order matters: per-feed cap runs before channel cap so a single prolific
 * feed cannot starve other feeds in the channel of representation after the
 * channel-wide trim.
 *
 * @param {object} application - Indiekit application
 * @returns {Promise<number>} Total number of items deleted across all channels
 */
export async function cleanupStaleItems(application) {
  const itemsCollection = getCollection(application);
  const channelsCollection = application.collections.get("microsub_channels");

  const channels = await channelsCollection.find({}).toArray();
  let totalDeleted = 0;

  for (const channel of channels) {
    // Notifications channel (webmentions) is exempt — high-signal, kept indefinitely.
    if (channel.uid === "notifications") continue;

    const settings = channel.settings || {};
    const maxItems = settings.maxItems ?? DEFAULT_MAX_ITEMS;
    const maxItemsPerFeed =
      settings.maxItemsPerFeed ?? DEFAULT_MAX_ITEMS_PER_FEED;
    const maxUnreadAgeDays =
      settings.maxUnreadAgeDays ?? DEFAULT_MAX_UNREAD_AGE_DAYS;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxUnreadAgeDays);
    const cutoffIso = cutoff.toISOString();
    let channelDeleted = 0;
    let staleDeleted = 0;
    let perFeedDeleted = 0;
    let channelCapDeleted = 0;

    // 1. Drop stripped skeletons older than cutoff (served their dedup purpose).
    const strippedResult = await itemsCollection.deleteMany({
      channelId: channel._id,
      _stripped: true,
      $or: [
        { published: { $lt: cutoff } },
        {
          published: { $exists: false },
          createdAt: { $lt: cutoffIso },
        },
      ],
    });
    staleDeleted += strippedResult.deletedCount;

    // 1b. Drop unread (or never-read) items older than cutoff.
    const unreadAgeResult = await itemsCollection.deleteMany({
      channelId: channel._id,
      _stripped: { $ne: true },
      $and: [
        {
          $or: [
            { readBy: { $exists: false } },
            { readBy: { $size: 0 } },
            { readBy: null },
          ],
        },
        {
          $or: [
            { published: { $lt: cutoff } },
            {
              published: { $exists: false },
              createdAt: { $lt: cutoffIso },
            },
          ],
        },
      ],
    });
    staleDeleted += unreadAgeResult.deletedCount;
    channelDeleted += staleDeleted;

    // 2. Per-feed cap. Iterate feeds in the channel; for each, delete oldest
    //    items beyond maxItemsPerFeed regardless of read state.
    const feedIds = await itemsCollection.distinct("feedId", {
      channelId: channel._id,
      feedId: { $exists: true, $ne: null },
    });

    for (const feedId of feedIds) {
      const excess = await itemsCollection
        .find({ channelId: channel._id, feedId })
        .sort({ published: -1, _id: -1 })
        .skip(maxItemsPerFeed)
        .project({ _id: 1 })
        .toArray();

      if (excess.length > 0) {
        const ids = excess.map((item) => item._id);
        const result = await itemsCollection.deleteMany({
          _id: { $in: ids },
        });
        perFeedDeleted += result.deletedCount;
        channelDeleted += result.deletedCount;
      }
    }

    // 3. Channel-wide cap. Catches items without feedId plus anything still over
    //    the per-channel ceiling after the per-feed pass.
    const excessChannel = await itemsCollection
      .find({ channelId: channel._id })
      .sort({ published: -1, _id: -1 })
      .skip(maxItems)
      .project({ _id: 1 })
      .toArray();

    if (excessChannel.length > 0) {
      const ids = excessChannel.map((item) => item._id);
      const result = await itemsCollection.deleteMany({ _id: { $in: ids } });
      channelCapDeleted += result.deletedCount;
      channelDeleted += result.deletedCount;
    }

    if (channelDeleted > 0) {
      console.info(
        `[Microsub] Retention cleanup "${channel.name}": deleted ${channelDeleted} items ` +
          `(stale: ${staleDeleted}, per-feed: ${perFeedDeleted}, channel-cap: ${channelCapDeleted}; ` +
          `maxItems=${maxItems}, maxItemsPerFeed=${maxItemsPerFeed}, maxUnreadAgeDays=${maxUnreadAgeDays})`,
      );
    }
    totalDeleted += channelDeleted;
  }

  if (totalDeleted > 0) {
    console.info(
      `[Microsub] Retention cleanup complete: ${totalDeleted} total items deleted across ${channels.length} channels`,
    );
  }

  return totalDeleted;
}

/**
 * One-time migration: remove the abandoned "Fediverse" channel and its items.
 * The microsub reader briefly tried to ingest ActivityPub outboxes into a
 * dedicated channel (uid: "activitypub"). That feature was abandoned — fediverse
 * federation lives entirely in the separate `indiekit-endpoint-activitypub`
 * plugin now. This migration cleans up the leftover channel and items.
 * Idempotent — safe to run on every startup.
 * @param {object} application - Indiekit application
 * @returns {Promise<{ channelsRemoved: number, itemsRemoved: number }>}
 */
export async function removeActivityPubData(application) {
  const itemsCollection = getCollection(application);
  const channelsCollection = application.collections.get("microsub_channels");

  const apChannels = await channelsCollection
    .find({ uid: "activitypub" })
    .toArray();

  if (apChannels.length === 0) {
    return { channelsRemoved: 0, itemsRemoved: 0 };
  }

  const channelIds = apChannels.map((c) => c._id);

  const itemsResult = await itemsCollection.deleteMany({
    channelId: { $in: channelIds },
  });

  const channelsResult = await channelsCollection.deleteMany({
    _id: { $in: channelIds },
  });

  console.info(
    `[Microsub] Removed abandoned Fediverse channel: ${channelsResult.deletedCount} channel(s), ${itemsResult.deletedCount} item(s)`,
  );

  return {
    channelsRemoved: channelsResult.deletedCount,
    itemsRemoved: itemsResult.deletedCount,
  };
}
