/**
 * Follow/unfollow controller
 * @module controllers/follow
 */

import { IndiekitError } from "@indiekit/error";

import { refreshFeedNow } from "../polling/scheduler.js";
import { getChannel } from "../storage/channels.js";
import {
  createFeed,
  deleteFeed,
  getFeedByUrl,
  getFeedsForChannel,
} from "../storage/feeds.js";
import { getUserId } from "../utils/auth.js";
import { createFeedResponse } from "../utils/jf2.js";
import { validateChannel, validateUrl } from "../utils/validation.js";
import {
  unsubscribe as websubUnsubscribe,
  getCallbackUrl,
} from "../websub/subscriber.js";

/**
 * List followed feeds for a channel
 * GET ?action=follow&channel=<uid>
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function list(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { channel } = request.query;

  validateChannel(channel);

  const channelDocument = await getChannel(application, channel, userId);
  if (!channelDocument) {
    throw new IndiekitError("Channel not found", { status: 404 });
  }

  const feeds = await getFeedsForChannel(application, channelDocument._id);
  const items = feeds.map((feed) => createFeedResponse(feed));

  response.json({ items });
}

/**
 * Follow a feed URL
 * POST ?action=follow
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function follow(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { channel, url } = request.body;

  validateChannel(channel);
  validateUrl(url);

  const channelDocument = await getChannel(application, channel, userId);
  if (!channelDocument) {
    throw new IndiekitError("Channel not found", { status: 404 });
  }

  // Create feed subscription
  const feed = await createFeed(application, {
    channelId: channelDocument._id,
    url,
    title: undefined, // Will be populated on first fetch
    photo: undefined,
  });

  // Trigger immediate fetch in background (don't await)
  // This will also discover and subscribe to WebSub hubs
  refreshFeedNow(application, feed._id).catch((error) => {
    console.error(`[Microsub] Error fetching new feed ${url}:`, error.message);
  });

  response.status(201).json(createFeedResponse(feed));
}

/**
 * Unfollow a feed URL
 * POST ?action=unfollow
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function unfollow(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { channel, url } = request.body;

  validateChannel(channel);
  validateUrl(url);

  const channelDocument = await getChannel(application, channel, userId);
  if (!channelDocument) {
    throw new IndiekitError("Channel not found", { status: 404 });
  }

  // Get feed before deletion to check for WebSub subscription
  const feed = await getFeedByUrl(application, channelDocument._id, url);

  // Unsubscribe from WebSub hub if active
  if (feed?.websub?.hub) {
    const baseUrl = application.url;
    if (baseUrl) {
      const callbackUrl = getCallbackUrl(baseUrl, feed._id.toString());
      websubUnsubscribe(application, feed, callbackUrl).catch((error) => {
        console.error(
          `[Microsub] WebSub unsubscribe error for ${url}:`,
          error.message,
        );
      });
    }
  }

  const deleted = await deleteFeed(application, channelDocument._id, url);
  if (!deleted) {
    throw new IndiekitError("Feed not found", { status: 404 });
  }

  response.json({ result: "ok" });
}

export const followController = { list, follow, unfollow };
