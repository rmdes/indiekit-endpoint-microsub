/**
 * Feed management
 * @module controllers/reader/feed
 */

import { validateFeedUrl } from "../../feeds/validator.js";
import { refreshFeedNow } from "../../polling/scheduler.js";
import { getChannel } from "../../storage/channels.js";
import {
  getFeedsForChannel,
  getFeedById,
  createFeed,
  deleteFeed,
  updateFeed,
} from "../../storage/feeds.js";
import { getUserId } from "../../utils/auth.js";

export { rediscoverFeed, refreshFeed } from "./feed-repair.js";

/**
 * View feeds for a channel
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function feeds(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { uid } = request.params;

  const channelDocument = await getChannel(application, uid, userId);
  if (!channelDocument) {
    return response.status(404).render("404");
  }

  const feedList = await getFeedsForChannel(application, channelDocument._id);

  response.render("feeds", {
    title: request.__("microsub.feeds.title"),
    channel: channelDocument,
    feeds: feedList,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "channels",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Channels", href: `${request.baseUrl}/channels` },
      { text: channelDocument.name, href: `${request.baseUrl}/channels/${uid}` },
      { text: "Feeds" },
    ],
  });
}

/**
 * Add feed to channel
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function addFeed(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { uid } = request.params;
  const { url } = request.body;

  const channelDocument = await getChannel(application, uid, userId);
  if (!channelDocument) {
    return response.status(404).render("404");
  }

  try {
    // Create feed subscription (throws DUPLICATE_FEED if already exists)
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

    response.redirect(`${request.baseUrl}/channels/${uid}/feeds`);
  } catch (error) {
    if (error.code === "DUPLICATE_FEED") {
      // Re-render feeds page with error message
      const feedList = await getFeedsForChannel(application, channelDocument._id);
      return response.render("feeds", {
        title: request.__("microsub.feeds.title"),
        channel: channelDocument,
        feeds: feedList,
        baseUrl: request.baseUrl,
        readerBaseUrl: request.baseUrl,
        activeView: "channels",
        error: `This feed already exists in channel "${error.channelName}"`,
        breadcrumbs: [
          { text: "Reader", href: request.baseUrl },
          { text: "Channels", href: `${request.baseUrl}/channels` },
          { text: channelDocument.name, href: `${request.baseUrl}/channels/${uid}` },
          { text: "Feeds" },
        ],
      });
    }
    throw error;
  }
}

/**
 * Remove feed from channel
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function removeFeed(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { uid } = request.params;
  const { url } = request.body;

  const channelDocument = await getChannel(application, uid, userId);
  if (!channelDocument) {
    return response.status(404).render("404");
  }

  await deleteFeed(application, channelDocument._id, url);

  response.redirect(`${request.baseUrl}/channels/${uid}/feeds`);
}

/**
 * View single feed details with status - redirects to edit form
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function feedDetails(request, response) {
  const { uid, feedId } = request.params;
  // Redirect to edit form which shows all details
  response.redirect(`${request.baseUrl}/channels/${uid}/feeds/${feedId}/edit`);
}

/**
 * Edit feed URL form
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function editFeedForm(request, response) {
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

  response.render("feed-edit", {
    title: request.__("microsub.feeds.edit"),
    channel: channelDocument,
    feed,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "channels",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Channels", href: `${request.baseUrl}/channels` },
      { text: channelDocument.name, href: `${request.baseUrl}/channels/${uid}` },
      { text: "Feeds", href: `${request.baseUrl}/channels/${uid}/feeds` },
      { text: "Edit" },
    ],
  });
}

/**
 * Update feed URL
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function updateFeedUrl(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { uid, feedId } = request.params;
  const { url: newUrl } = request.body;

  const channelDocument = await getChannel(application, uid, userId);
  if (!channelDocument) {
    return response.status(404).render("404");
  }

  const feed = await getFeedById(application, feedId);
  if (!feed || feed.channelId.toString() !== channelDocument._id.toString()) {
    return response.status(404).render("404");
  }

  // Validate the new URL is a valid feed
  const validation = await validateFeedUrl(newUrl);

  if (!validation.valid) {
    return response.render("feed-edit", {
      title: request.__("microsub.feeds.edit"),
      channel: channelDocument,
      feed,
      error: validation.error,
      baseUrl: request.baseUrl,
      readerBaseUrl: request.baseUrl,
      activeView: "channels",
      breadcrumbs: [
        { text: "Reader", href: request.baseUrl },
        { text: "Channels", href: `${request.baseUrl}/channels` },
        { text: channelDocument.name, href: `${request.baseUrl}/channels/${uid}` },
        { text: "Feeds", href: `${request.baseUrl}/channels/${uid}/feeds` },
        { text: "Edit" },
      ],
    });
  }

  // Update the feed URL and reset error state
  await updateFeed(application, feedId, {
    url: newUrl,
    title: validation.title || feed.title,
    status: "active",
    lastError: undefined,
    lastErrorAt: undefined,
    consecutiveErrors: 0,
  });

  // Trigger immediate fetch
  refreshFeedNow(application, feedId).catch((error) => {
    console.error(
      `[Microsub] Error refreshing updated feed ${newUrl}:`,
      error.message,
    );
  });

  response.redirect(`${request.baseUrl}/channels/${uid}/feeds`);
}

