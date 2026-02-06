/**
 * Mute controller
 * @module controllers/mute
 */

import { IndiekitError } from "@indiekit/error";

import { getUserId } from "../utils/auth.js";
import { validateChannel, validateUrl } from "../utils/validation.js";

/**
 * Get muted collection
 * @param {object} application - Indiekit application
 * @returns {object} MongoDB collection
 */
function getCollection(application) {
  return application.collections.get("microsub_muted");
}

/**
 * List muted URLs for a channel
 * GET ?action=mute&channel=<uid>
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function list(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { channel } = request.query;

  // Channel can be "global" or a specific channel UID
  const isGlobal = channel === "global";

  const collection = getCollection(application);
  const filter = { userId };

  if (!isGlobal && channel) {
    // Get channel-specific mutes
    const channelsCollection = application.collections.get("microsub_channels");
    const channelDocument = await channelsCollection.findOne({ uid: channel });
    if (channelDocument) {
      filter.channelId = channelDocument._id;
    }
  }
  // For global mutes, we query without channelId (matches all channels)

  // eslint-disable-next-line unicorn/no-array-callback-reference -- filter is MongoDB query object
  const muted = await collection.find(filter).toArray();
  const items = muted.map((m) => ({ url: m.url }));

  response.json({ items });
}

/**
 * Mute a URL
 * POST ?action=mute
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function mute(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { channel, url } = request.body;

  validateUrl(url);

  const collection = getCollection(application);
  const isGlobal = channel === "global" || !channel;

  let channelId;
  if (!isGlobal) {
    validateChannel(channel);
    const channelsCollection = application.collections.get("microsub_channels");
    const channelDocument = await channelsCollection.findOne({ uid: channel });
    if (!channelDocument) {
      throw new IndiekitError("Channel not found", { status: 404 });
    }
    channelId = channelDocument._id;
  }

  // Check if already muted
  const existing = await collection.findOne({ userId, channelId, url });
  if (!existing) {
    await collection.insertOne({
      userId,
      channelId,
      url,
      createdAt: new Date(),
    });
  }

  response.json({ result: "ok" });
}

/**
 * Unmute a URL
 * POST ?action=unmute
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function unmute(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { channel, url } = request.body;

  validateUrl(url);

  const collection = getCollection(application);
  const isGlobal = channel === "global" || !channel;

  let channelId;
  if (!isGlobal) {
    const channelsCollection = application.collections.get("microsub_channels");
    const channelDocument = await channelsCollection.findOne({ uid: channel });
    if (channelDocument) {
      channelId = channelDocument._id;
    }
  }

  await collection.deleteOne({ userId, channelId, url });

  response.json({ result: "ok" });
}

export const muteController = { list, mute, unmute };
