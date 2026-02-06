/**
 * Filter storage operations (mute, block, channel filters)
 * @module storage/filters
 */

import { ObjectId } from "mongodb";

/**
 * Get muted collection
 * @param {object} application - Indiekit application
 * @returns {object} MongoDB collection
 */
function getMutedCollection(application) {
  return application.collections.get("microsub_muted");
}

/**
 * Get blocked collection
 * @param {object} application - Indiekit application
 * @returns {object} MongoDB collection
 */
function getBlockedCollection(application) {
  return application.collections.get("microsub_blocked");
}

/**
 * Check if a URL is muted for a user/channel
 * @param {object} application - Indiekit application
 * @param {string} userId - User ID
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {string} url - URL to check
 * @returns {Promise<boolean>} Whether the URL is muted
 */
export async function isMuted(application, userId, channelId, url) {
  const collection = getMutedCollection(application);
  const channelObjectId =
    typeof channelId === "string" ? new ObjectId(channelId) : channelId;

  // Check for channel-specific mute
  const channelMute = await collection.findOne({
    userId,
    channelId: channelObjectId,
    url,
  });
  if (channelMute) return true;

  // Check for global mute (no channelId)
  const globalMute = await collection.findOne({
    userId,
    channelId: { $exists: false },
    url,
  });
  return !!globalMute;
}

/**
 * Check if a URL is blocked for a user
 * @param {object} application - Indiekit application
 * @param {string} userId - User ID
 * @param {string} url - URL to check
 * @returns {Promise<boolean>} Whether the URL is blocked
 */
export async function isBlocked(application, userId, url) {
  const collection = getBlockedCollection(application);
  const blocked = await collection.findOne({ userId, url });
  return !!blocked;
}

/**
 * Check if an item passes all filters
 * @param {object} application - Indiekit application
 * @param {string} userId - User ID
 * @param {object} channel - Channel document with settings
 * @param {object} item - Feed item to check
 * @returns {Promise<boolean>} Whether the item passes all filters
 */
export async function passesAllFilters(application, userId, channel, item) {
  // Check if author URL is blocked
  if (
    item.author?.url &&
    (await isBlocked(application, userId, item.author.url))
  ) {
    return false;
  }

  // Check if source URL is muted
  if (
    item._source?.url &&
    (await isMuted(application, userId, channel._id, item._source.url))
  ) {
    return false;
  }

  // Check channel settings filters
  if (channel?.settings) {
    // Check excludeTypes
    if (!passesTypeFilter(item, channel.settings)) {
      return false;
    }

    // Check excludeRegex
    if (!passesRegexFilter(item, channel.settings)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if an item passes the excludeTypes filter
 * @param {object} item - Feed item
 * @param {object} settings - Channel settings
 * @returns {boolean} Whether the item passes
 */
export function passesTypeFilter(item, settings) {
  if (!settings.excludeTypes || settings.excludeTypes.length === 0) {
    return true;
  }

  const itemType = detectInteractionType(item);
  return !settings.excludeTypes.includes(itemType);
}

/**
 * Check if an item passes the excludeRegex filter
 * @param {object} item - Feed item
 * @param {object} settings - Channel settings
 * @returns {boolean} Whether the item passes
 */
export function passesRegexFilter(item, settings) {
  if (!settings.excludeRegex) {
    return true;
  }

  try {
    const regex = new RegExp(settings.excludeRegex, "i");
    const searchText = [
      item.name,
      item.summary,
      item.content?.text,
      item.content?.html,
    ]
      .filter(Boolean)
      .join(" ");

    return !regex.test(searchText);
  } catch {
    // Invalid regex, skip filter
    return true;
  }
}

/**
 * Detect the interaction type of an item
 * @param {object} item - Feed item
 * @returns {string} Interaction type
 */
export function detectInteractionType(item) {
  if (item["like-of"] && item["like-of"].length > 0) {
    return "like";
  }
  if (item["repost-of"] && item["repost-of"].length > 0) {
    return "repost";
  }
  if (item["bookmark-of"] && item["bookmark-of"].length > 0) {
    return "bookmark";
  }
  if (item["in-reply-to"] && item["in-reply-to"].length > 0) {
    return "reply";
  }
  if (item.rsvp) {
    return "rsvp";
  }
  if (item.checkin) {
    return "checkin";
  }

  return "post";
}

/**
 * Get all muted URLs for a user/channel
 * @param {object} application - Indiekit application
 * @param {string} userId - User ID
 * @param {ObjectId|string} [channelId] - Channel ObjectId (optional, for channel-specific)
 * @returns {Promise<Array>} Array of muted URLs
 */
export async function getMutedUrls(application, userId, channelId) {
  const collection = getMutedCollection(application);
  const filter = { userId };

  if (channelId) {
    const channelObjectId =
      typeof channelId === "string" ? new ObjectId(channelId) : channelId;
    filter.channelId = channelObjectId;
  }

  // eslint-disable-next-line unicorn/no-array-callback-reference -- filter is MongoDB query object
  const muted = await collection.find(filter).toArray();
  return muted.map((m) => m.url);
}

/**
 * Get all blocked URLs for a user
 * @param {object} application - Indiekit application
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of blocked URLs
 */
export async function getBlockedUrls(application, userId) {
  const collection = getBlockedCollection(application);
  const blocked = await collection.find({ userId }).toArray();
  return blocked.map((b) => b.url);
}

/**
 * Update channel filter settings
 * @param {object} application - Indiekit application
 * @param {ObjectId|string} channelId - Channel ObjectId
 * @param {object} filters - Filter settings to update
 * @param {Array} [filters.excludeTypes] - Post types to exclude
 * @param {string} [filters.excludeRegex] - Regex pattern to exclude
 * @returns {Promise<object>} Updated channel
 */
export async function updateChannelFilters(application, channelId, filters) {
  const collection = application.collections.get("microsub_channels");
  const channelObjectId =
    typeof channelId === "string" ? new ObjectId(channelId) : channelId;

  const updateFields = {};

  if (filters.excludeTypes !== undefined) {
    updateFields["settings.excludeTypes"] = filters.excludeTypes;
  }

  if (filters.excludeRegex !== undefined) {
    updateFields["settings.excludeRegex"] = filters.excludeRegex;
  }

  const result = await collection.findOneAndUpdate(
    { _id: channelObjectId },
    { $set: updateFields },
    { returnDocument: "after" },
  );

  return result;
}

/**
 * Create indexes for filter collections
 * @param {object} application - Indiekit application
 * @returns {Promise<void>}
 */
export async function createFilterIndexes(application) {
  const mutedCollection = getMutedCollection(application);
  const blockedCollection = getBlockedCollection(application);

  // Muted collection indexes
  await mutedCollection.createIndex({ userId: 1, channelId: 1, url: 1 });
  await mutedCollection.createIndex({ userId: 1 });

  // Blocked collection indexes
  await blockedCollection.createIndex({ userId: 1, url: 1 }, { unique: true });
  await blockedCollection.createIndex({ userId: 1 });
}
