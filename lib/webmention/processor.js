/**
 * Webmention processor
 * @module webmention/processor
 */

import { getRedisClient, publishEvent } from "../cache/redis.js";
import { ensureNotificationsChannel } from "../storage/channels.js";

import { verifyWebmention } from "./verifier.js";

/**
 * Get notifications collection
 * @param {object} application - Indiekit application
 * @returns {object} MongoDB collection
 */
function getCollection(application) {
  return application.collections.get("microsub_notifications");
}

/**
 * Process a webmention
 * @param {object} application - Indiekit application
 * @param {string} source - Source URL
 * @param {string} target - Target URL
 * @param {string} [userId] - User ID (for user-specific notifications)
 * @returns {Promise<object>} Processing result
 */
export async function processWebmention(application, source, target, userId) {
  // Verify the webmention
  const verification = await verifyWebmention(source, target);

  if (!verification.verified) {
    console.log(
      `[Microsub] Webmention verification failed: ${verification.error}`,
    );
    return {
      success: false,
      error: verification.error,
    };
  }

  // Ensure notifications channel exists
  const channel = await ensureNotificationsChannel(application, userId);

  // Check for existing notification (update if exists)
  const collection = getCollection(application);
  const existing = await collection.findOne({
    source,
    target,
    ...(userId && { userId }),
  });

  const notification = {
    source,
    target,
    userId,
    channelId: channel._id,
    type: verification.type,
    author: verification.author,
    content: verification.content,
    url: verification.url,
    published: verification.published
      ? new Date(verification.published)
      : new Date(),
    verified: true,
    readBy: [],
    updatedAt: new Date(),
  };

  if (existing) {
    // Update existing notification
    await collection.updateOne({ _id: existing._id }, { $set: notification });
    notification._id = existing._id;
  } else {
    // Insert new notification
    notification.createdAt = new Date();
    await collection.insertOne(notification);
  }

  // Publish real-time event
  const redis = getRedisClient(application);
  if (redis && userId) {
    await publishEvent(redis, `microsub:user:${userId}`, {
      type: "new-notification",
      channelId: channel._id.toString(),
      notification: transformNotification(notification),
    });
  }

  console.log(
    `[Microsub] Webmention processed: ${verification.type} from ${source}`,
  );

  return {
    success: true,
    type: verification.type,
    id: notification._id?.toString(),
  };
}

/**
 * Delete a webmention (when source no longer links to target)
 * @param {object} application - Indiekit application
 * @param {string} source - Source URL
 * @param {string} target - Target URL
 * @returns {Promise<boolean>} Whether deletion was successful
 */
export async function deleteWebmention(application, source, target) {
  const collection = getCollection(application);
  const result = await collection.deleteOne({ source, target });
  return result.deletedCount > 0;
}

/**
 * Get notifications for a user
 * @param {object} application - Indiekit application
 * @param {string} userId - User ID
 * @param {object} options - Query options
 * @returns {Promise<Array>} Array of notifications
 */
export async function getNotifications(application, userId, options = {}) {
  const collection = getCollection(application);
  const { limit = 20, unreadOnly = false } = options;

  const query = { userId };
  if (unreadOnly) {
    query.readBy = { $ne: userId };
  }

  /* eslint-disable unicorn/no-array-callback-reference, unicorn/no-array-sort -- MongoDB cursor methods */
  const notifications = await collection
    .find(query)
    .sort({ published: -1 })
    .limit(limit)
    .toArray();
  /* eslint-enable unicorn/no-array-callback-reference, unicorn/no-array-sort */

  return notifications.map((n) => transformNotification(n, userId));
}

/**
 * Mark notifications as read
 * @param {object} application - Indiekit application
 * @param {string} userId - User ID
 * @param {Array} ids - Notification IDs to mark as read
 * @returns {Promise<number>} Number of notifications updated
 */
export async function markNotificationsRead(application, userId, ids) {
  const collection = getCollection(application);
  const { ObjectId } = await import("mongodb");

  const objectIds = ids.map((id) => {
    try {
      return new ObjectId(id);
    } catch {
      return id;
    }
  });

  const result = await collection.updateMany(
    { _id: { $in: objectIds } },
    { $addToSet: { readBy: userId } },
  );

  return result.modifiedCount;
}

/**
 * Get unread notification count
 * @param {object} application - Indiekit application
 * @param {string} userId - User ID
 * @returns {Promise<number>} Unread count
 */
export async function getUnreadNotificationCount(application, userId) {
  const collection = getCollection(application);
  return collection.countDocuments({
    userId,
    readBy: { $ne: userId },
  });
}

/**
 * Transform notification to API format
 * @param {object} notification - Database notification
 * @param {string} [userId] - User ID for read state
 * @returns {object} Transformed notification
 */
function transformNotification(notification, userId) {
  return {
    type: "entry",
    uid: notification._id?.toString(),
    url: notification.url || notification.source,
    published: notification.published?.toISOString(),
    author: notification.author,
    content: notification.content,
    _source: notification.source,
    _target: notification.target,
    _type: notification.type, // like, reply, repost, bookmark, mention
    _is_read: userId ? notification.readBy?.includes(userId) : false,
  };
}

/**
 * Create indexes for notifications
 * @param {object} application - Indiekit application
 * @returns {Promise<void>}
 */
export async function createNotificationIndexes(application) {
  const collection = getCollection(application);

  await collection.createIndex({ userId: 1, published: -1 });
  await collection.createIndex({ source: 1, target: 1 });
  await collection.createIndex({ userId: 1, readBy: 1 });
}
