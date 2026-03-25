/**
 * Feed discovery UI
 * @module controllers/reader/search
 */

import { discoverAndValidateFeeds } from "../../feeds/discovery.js";
import { validateFeedUrl } from "../../feeds/validator.js";
import { refreshFeedNow } from "../../polling/scheduler.js";
import { getChannels, getChannel } from "../../storage/channels.js";
import { createFeed } from "../../storage/feeds.js";
import { getUserId } from "../../utils/auth.js";

/**
 * Search/discover feeds page
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function searchPage(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);

  const channelList = await getChannels(application, userId);

  response.render("search", {
    title: request.__("microsub.search.title"),
    channels: channelList,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "channels",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Search" },
    ],
  });
}

/**
 * Search for feeds from URL - enhanced with validation
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function searchFeeds(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { query } = request.body;

  const channelList = await getChannels(application, userId);

  let results = [];
  let discoveryError = null;

  if (query) {
    try {
      // Use enhanced discovery with validation
      results = await discoverAndValidateFeeds(query);
    } catch (error) {
      discoveryError = error.message;
    }
  }

  response.render("search", {
    title: request.__("microsub.search.title"),
    channels: channelList,
    query,
    results,
    discoveryError,
    searched: true,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "channels",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Search" },
    ],
  });
}

/**
 * Subscribe to a feed from search results - with validation
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function subscribe(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { url, channel: channelUid, skipValidation } = request.body;

  const channelDocument = await getChannel(application, channelUid, userId);
  if (!channelDocument) {
    return response.status(404).render("404");
  }

  // Validate feed unless explicitly skipped (for power users)
  if (!skipValidation) {
    const validation = await validateFeedUrl(url);

    if (!validation.valid) {
      const channelList = await getChannels(application, userId);
      return response.render("search", {
        title: request.__("microsub.search.title"),
        channels: channelList,
        query: url,
        validationError: validation.error,
        baseUrl: request.baseUrl,
        readerBaseUrl: request.baseUrl,
        activeView: "channels",
        breadcrumbs: [
          { text: "Reader", href: request.baseUrl },
          { text: "Search" },
        ],
      });
    }

    // Warn about comments feeds but allow subscription
    if (validation.isCommentsFeed) {
      console.warn(`[Microsub] Subscribing to comments feed: ${url}`);
    }
  }

  // Create feed subscription (throws DUPLICATE_FEED if already exists elsewhere)
  try {
    const feed = await createFeed(application, {
      channelId: channelDocument._id,
      url,
      title: undefined,
      photo: undefined,
    });

    // Trigger immediate fetch in background
    refreshFeedNow(application, feed._id).catch((error) => {
      console.error(`[Microsub] Error fetching new feed ${url}:`, error.message);
    });

    response.redirect(`${request.baseUrl}/channels/${channelUid}/feeds`);
  } catch (error) {
    if (error.code === "DUPLICATE_FEED") {
      const channelList = await getChannels(application, userId);
      return response.render("search", {
        title: request.__("microsub.search.title"),
        channels: channelList,
        query: url,
        validationError: `This feed already exists in channel "${error.channelName}"`,
        baseUrl: request.baseUrl,
        readerBaseUrl: request.baseUrl,
        activeView: "channels",
        breadcrumbs: [
          { text: "Reader", href: request.baseUrl },
          { text: "Search" },
        ],
      });
    }
    throw error;
  }
}
