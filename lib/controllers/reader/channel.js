/**
 * Channel CRUD + HTML fragments
 * @module controllers/reader/channel
 */

import {
  getChannels,
  getChannel,
  createChannel,
  updateChannelSettings,
  deleteChannel,
} from "../../storage/channels.js";
import { getFeedsForChannel } from "../../storage/feeds.js";
import { getTimelineItems } from "../../storage/items.js";
import { countReadItems } from "../../storage/items-read-state.js";
import { getUserId } from "../../utils/auth.js";
import {
  validateChannelName,
  validateExcludeTypes,
  validateExcludeRegex,
} from "../../utils/validation.js";
import { proxyItemImages } from "../../media/proxy.js";

/**
 * Reader index - redirect to channels
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function index(request, response) {
  const lastView = request.session?.microsubView || "timeline";
  const validViews = ["channels", "deck", "timeline"];
  const view = validViews.includes(lastView) ? lastView : "timeline";
  response.redirect(`${request.baseUrl}/${view}`);
}

/**
 * List channels
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function channels(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);

  const channelList = await getChannels(application, userId);

  if (request.session) request.session.microsubView = "channels";

  response.render("reader", {
    title: request.__("microsub.views.channels"),
    channels: channelList,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "channels",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Channels" },
    ],
  });
}

/**
 * New channel form
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function newChannel(request, response) {
  response.render("channel-new", {
    title: request.__("microsub.channels.new"),
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "channels",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Channels", href: `${request.baseUrl}/channels` },
      { text: request.__("microsub.channels.new") },
    ],
  });
}

/**
 * Create channel
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function createChannelAction(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { name } = request.body;

  validateChannelName(name);

  await createChannel(application, { name, userId });

  response.redirect(`${request.baseUrl}/channels`);
}

/**
 * View channel timeline
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function channel(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { uid } = request.params;
  const { before, after, showRead } = request.query;

  const channelDocument = await getChannel(application, uid, userId);
  if (!channelDocument) {
    return response.status(404).render("404");
  }

  // Check if showing read items
  const showReadItems = showRead === "true";

  const timeline = await getTimelineItems(application, channelDocument._id, {
    before,
    after,
    userId,
    showRead: showReadItems,
  });

  // Proxy images through media endpoint for privacy
  const proxyBaseUrl = application.url;
  if (proxyBaseUrl && timeline.items) {
    timeline.items = timeline.items.map((item) =>
      proxyItemImages(item, proxyBaseUrl),
    );
  }

  // Count read items to show "View read items" button
  const readCount = await countReadItems(
    application,
    channelDocument._id,
    userId,
  );

  response.render("channel", {
    title: channelDocument.name,
    channel: channelDocument,
    items: timeline.items,
    paging: timeline.paging,
    readCount,
    showRead: showReadItems,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "channels",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Channels", href: `${request.baseUrl}/channels` },
      { text: channelDocument.name },
    ],
  });
}

/**
 * Return rendered HTML fragments for infinite scroll
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function channelHtml(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { uid } = request.params;
  const { before, after, showRead } = request.query;

  const channelDocument = await getChannel(application, uid, userId);
  if (!channelDocument) {
    return response.status(404).json({ error: "Channel not found" });
  }

  const showReadItems = showRead === "true";

  const timeline = await getTimelineItems(application, channelDocument._id, {
    before,
    after,
    userId,
    showRead: showReadItems,
  });

  // Proxy images
  const proxyBaseUrl = application.url;
  if (proxyBaseUrl && timeline.items) {
    timeline.items = timeline.items.map((item) =>
      proxyItemImages(item, proxyBaseUrl),
    );
  }

  // Render items via layout-less fragment template (standard response.render
  // with callback returns HTML string without sending a response)
  const fragmentHtml = await new Promise((resolve, reject) => {
    response.render("partials/items-fragment", {
      items: timeline.items,
      channel: channelDocument,
      baseUrl: request.baseUrl,
    }, (error, html) => error ? reject(error) : resolve(html));
  });

  response.json({
    html: fragmentHtml,
    paging: timeline.paging,
    count: timeline.items.length,
  });
}

/**
 * Channel settings form
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function settings(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { uid } = request.params;

  const channelDocument = await getChannel(application, uid, userId);
  if (!channelDocument) {
    return response.status(404).render("404");
  }

  response.render("settings", {
    title: request.__("microsub.settings.title", {
      channel: channelDocument.name,
    }),
    channel: channelDocument,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "channels",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Channels", href: `${request.baseUrl}/channels` },
      { text: channelDocument.name, href: `${request.baseUrl}/channels/${uid}` },
      { text: "Settings" },
    ],
  });
}

/**
 * Update channel settings
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function updateSettings(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { uid } = request.params;
  const { excludeTypes, excludeRegex } = request.body;

  const channelDocument = await getChannel(application, uid, userId);
  if (!channelDocument) {
    return response.status(404).render("404");
  }

  const validatedTypes = validateExcludeTypes(
    Array.isArray(excludeTypes) ? excludeTypes : [excludeTypes].filter(Boolean),
  );
  const validatedRegex = validateExcludeRegex(excludeRegex);

  await updateChannelSettings(
    application,
    uid,
    {
      excludeTypes: validatedTypes,
      excludeRegex: validatedRegex,
    },
    userId,
  );

  response.redirect(`${request.baseUrl}/channels/${uid}`);
}

/**
 * Delete channel
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function deleteChannelAction(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { uid } = request.params;

  // Don't allow deleting system channels
  if (uid === "notifications" || uid === "activitypub") {
    return response.redirect(`${request.baseUrl}/channels`);
  }

  const channelDocument = await getChannel(application, uid, userId);
  if (!channelDocument) {
    return response.status(404).render("404");
  }

  await deleteChannel(application, uid, userId);

  response.redirect(`${request.baseUrl}/channels`);
}
