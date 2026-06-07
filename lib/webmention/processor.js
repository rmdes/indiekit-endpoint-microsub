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
    console.info(
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
      : new Date(), // Keep as Date for query compatibility
    verified: true,
    readBy: [],
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    // Update existing notification
    await collection.updateOne({ _id: existing._id }, { $set: notification });
    notification._id = existing._id;
  } else {
    // Insert new notification
    notification.createdAt = new Date().toISOString();
    await collection.insertOne(notification);
  }

  // Publish real-time event
  const redis = await getRedisClient(application);
  if (redis && userId) {
    await publishEvent(redis, `microsub:user:${userId}`, {
      type: "new-notification",
      channelId: channel._id.toString(),
      notification: transformNotification(notification),
    });
  }

  console.info(
    `[Microsub] Webmention processed: ${verification.type} from ${source}`,
  );

  return {
    success: true,
    type: verification.type,
    id: notification._id?.toString(),
  };
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
    published: notification.published?.toISOString(), // Convert Date to ISO string
    author: notification.author,
    content: notification.content,
    _source: notification.source,
    _target: notification.target,
    _type: notification.type, // like, reply, repost, bookmark, mention
    _is_read: userId ? notification.readBy?.includes(userId) : false,
  };
}

