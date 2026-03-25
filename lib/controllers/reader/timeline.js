/**
 * Timeline views + read state
 * @module controllers/reader/timeline
 */

import { getChannel, getChannelById, getChannelsWithColors } from "../../storage/channels.js";
import {
  getTimelineItems,
  getAllTimelineItems,
  getItemById,
} from "../../storage/items.js";
import { markItemsRead } from "../../storage/items-read-state.js";
import { getUserId } from "../../utils/auth.js";
import { proxyItemImages } from "../../media/proxy.js";

/**
 * Timeline view - all channels chronologically
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function timeline(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { before, after } = request.query;

  // Get channels with colors for filtering UI and item decoration
  const channelList = await getChannelsWithColors(application, userId);

  // Build channel lookup map (ObjectId string -> { name, color, uid })
  const channelMap = new Map();
  for (const ch of channelList) {
    channelMap.set(ch._id.toString(), { name: ch.name, color: ch.color, uid: ch.uid });
  }

  // Parse excluded channel IDs from query params
  const excludeParam = request.query.exclude;
  const excludeIds = excludeParam
    ? (Array.isArray(excludeParam) ? excludeParam : [excludeParam])
    : [];

  // Exclude the notifications channel by default
  const notificationsChannel = channelList.find((ch) => ch.uid === "notifications");
  const excludeChannelIds = [...excludeIds];
  if (notificationsChannel && !excludeChannelIds.includes(notificationsChannel._id.toString())) {
    excludeChannelIds.push(notificationsChannel._id.toString());
  }

  const result = await getAllTimelineItems(application, {
    before,
    after,
    userId,
    excludeChannelIds,
  });

  // Proxy images
  const proxyBaseUrl = application.url;
  if (proxyBaseUrl && result.items) {
    result.items = result.items.map((item) => proxyItemImages(item, proxyBaseUrl));
  }

  // Decorate items with channel name and color
  for (const item of result.items) {
    if (item._channelId) {
      const info = channelMap.get(item._channelId);
      if (info) {
        item._channelName = info.name;
        item._channelColor = info.color;
        item._channelUid = info.uid;
      }
    }
  }

  // Set view preference cookie
  if (request.session) request.session.microsubView = "timeline";

  response.render("timeline", {
    title: "Timeline",
    channels: channelList,
    items: result.items,
    paging: result.paging,
    excludeIds,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "timeline",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Timeline" },
    ],
  });
}

/**
 * Return rendered HTML fragments for timeline infinite scroll
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function timelineHtml(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { before, after } = request.query;

  const channelList = await getChannelsWithColors(application, userId);
  const channelMap = new Map();
  for (const ch of channelList) {
    channelMap.set(ch._id.toString(), { name: ch.name, color: ch.color, uid: ch.uid });
  }

  const excludeParam = request.query.exclude;
  const excludeIds = excludeParam
    ? (Array.isArray(excludeParam) ? excludeParam : [excludeParam])
    : [];

  const notificationsChannel = channelList.find((ch) => ch.uid === "notifications");
  const excludeChannelIds = [...excludeIds];
  if (notificationsChannel && !excludeChannelIds.includes(notificationsChannel._id.toString())) {
    excludeChannelIds.push(notificationsChannel._id.toString());
  }

  const result = await getAllTimelineItems(application, {
    before,
    after,
    userId,
    excludeChannelIds,
  });

  const proxyBaseUrl = application.url;
  if (proxyBaseUrl && result.items) {
    result.items = result.items.map((item) => proxyItemImages(item, proxyBaseUrl));
  }

  for (const item of result.items) {
    if (item._channelId) {
      const info = channelMap.get(item._channelId);
      if (info) {
        item._channelName = info.name;
        item._channelColor = info.color;
        item._channelUid = info.uid;
      }
    }
  }

  const fragmentHtml = await new Promise((resolve, reject) => {
    response.render("partials/items-fragment-timeline", {
      items: result.items,
      baseUrl: request.baseUrl,
    }, (error, html) => error ? reject(error) : resolve(html));
  });

  response.json({
    html: fragmentHtml,
    paging: result.paging,
    count: result.items.length,
  });
}

/**
 * Mark all items in channel as read
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function markAllRead(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { channel: channelUid } = request.body;

  const channelDocument = await getChannel(application, channelUid, userId);
  if (!channelDocument) {
    return response.status(404).render("404");
  }

  // Mark all items as read using the special "last-read-entry" value
  await markItemsRead(
    application,
    channelDocument._id,
    ["last-read-entry"],
    userId,
  );

  response.redirect(`${request.baseUrl}/channels/${channelUid}`);
}

/**
 * Mark specific items as read (no-JS form fallback for mark-view-as-read)
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function markViewRead(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { channel: channelUid } = request.body;
  let { entry } = request.body;

  const channelDocument = await getChannel(application, channelUid, userId);
  if (!channelDocument) {
    return response.status(404).render("404");
  }

  const entryIds = Array.isArray(entry) ? entry : entry ? [entry] : [];
  if (entryIds.length > 0) {
    await markItemsRead(application, channelDocument._id, entryIds, userId);
  }

  response.redirect(`${request.baseUrl}/channels/${channelUid}`);
}

/**
 * View single item
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function item(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { id } = request.params;

  const itemDocument = await getItemById(application, id, userId);
  if (!itemDocument) {
    return response.status(404).render("404");
  }

  // Get the channel for this item (needed for mark-read)
  let channel = null;
  if (itemDocument.channelId) {
    channel = await getChannelById(application, itemDocument.channelId);
  }

  const itemBreadcrumbs = [
    { text: "Reader", href: request.baseUrl },
  ];
  if (channel) {
    itemBreadcrumbs.push(
      { text: "Channels", href: `${request.baseUrl}/channels` },
      { text: channel.name, href: `${request.baseUrl}/channels/${channel.uid}` },
    );
  }
  itemBreadcrumbs.push({ text: itemDocument.name || "Item" });

  response.render("item", {
    title: itemDocument.name || "Item",
    item: itemDocument,
    channel,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "channels",
    breadcrumbs: itemBreadcrumbs,
  });
}
