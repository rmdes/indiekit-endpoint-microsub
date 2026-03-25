/**
 * Feed repair operations (rediscover + force refresh)
 * @module controllers/reader/feed-repair
 */

import { discoverAndValidateFeeds, getBestFeed } from "../../feeds/discovery.js";
import { refreshFeedNow } from "../../polling/scheduler.js";
import { getChannel } from "../../storage/channels.js";
import { getFeedById, updateFeed, updateFeedStatus } from "../../storage/feeds.js";
import { getUserId } from "../../utils/auth.js";

/**
 * Rediscover feed - run discovery on URL to find actual RSS feed
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function rediscoverFeed(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { uid, feedId } = request.params;

  const channelDocument = await getChannel(application, uid, userId);
  if (!channelDocument) {
    return response.status(404).render("404");
  }

  const feed = await getFeedById(application, feedId);
  if (!feed || feed.channelId.toString() !== channelDocument._id.toString()) {
    return response.status(404).render("404");
  }

  // Run feed discovery on the current URL
  try {
    const discoveredFeeds = await discoverAndValidateFeeds(feed.url);
    const bestFeed = getBestFeed(discoveredFeeds);

    if (bestFeed && bestFeed.url !== feed.url) {
      // Found a different (better) feed URL - update the record
      await updateFeed(application, feedId, {
        url: bestFeed.url,
        title: bestFeed.title || feed.title,
        status: "active",
        lastError: undefined,
        lastErrorAt: undefined,
        consecutiveErrors: 0,
      });

      console.info(
        `[Microsub] Rediscovered feed: ${feed.url} -> ${bestFeed.url}`,
      );

      // Trigger immediate fetch
      refreshFeedNow(application, feedId).catch((error) => {
        console.error(
          `[Microsub] Error refreshing rediscovered feed:`,
          error.message,
        );
      });
    } else if (bestFeed) {
      // Same URL but valid - just reset error state and refresh
      await updateFeedStatus(application, feedId, { success: true });
      await updateFeed(application, feedId, {
        status: "active",
        lastError: undefined,
        lastErrorAt: undefined,
        consecutiveErrors: 0,
      });

      refreshFeedNow(application, feedId).catch((error) => {
        console.error(`[Microsub] Error refreshing feed:`, error.message);
      });
    } else {
      // No valid feed found
      await updateFeedStatus(application, feedId, {
        success: false,
        error: "No valid feed found at this URL",
      });
    }
  } catch (error) {
    await updateFeedStatus(application, feedId, {
      success: false,
      error: error.message,
    });
  }

  response.redirect(`${request.baseUrl}/channels/${uid}/feeds`);
}

/**
 * Force refresh a feed
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function refreshFeed(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { uid, feedId } = request.params;

  const channelDocument = await getChannel(application, uid, userId);
  if (!channelDocument) {
    return response.status(404).render("404");
  }

  const feed = await getFeedById(application, feedId);
  if (!feed || feed.channelId.toString() !== channelDocument._id.toString()) {
    return response.status(404).render("404");
  }

  // Trigger immediate fetch
  refreshFeedNow(application, feedId).catch((error) => {
    console.error(`[Microsub] Error refreshing feed ${feed.url}:`, error.message);
  });

  response.redirect(`${request.baseUrl}/channels/${uid}/feeds`);
}
