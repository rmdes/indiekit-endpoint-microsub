/**
 * Reader UI controller
 * @module controllers/reader
 */

import { discoverAndValidateFeeds, getBestFeed } from "../feeds/discovery.js";
import { validateFeedUrl } from "../feeds/validator.js";
import { ObjectId } from "mongodb";
import { refreshFeedNow } from "../polling/scheduler.js";
import {
  getChannels,
  getChannelsWithColors,
  getChannel,
  createChannel,
  updateChannelSettings,
  deleteChannel,
} from "../storage/channels.js";
import {
  getFeedsForChannel,
  getFeedById,
  createFeed,
  deleteFeed,
  updateFeed,
  updateFeedStatus,
} from "../storage/feeds.js";
import {
  getTimelineItems,
  getAllTimelineItems,
  getItemById,
  markItemsRead,
  countReadItems,
} from "../storage/items.js";
import { fetchActorOutbox } from "../activitypub/outbox-fetcher.js";
import { getUserId } from "../utils/auth.js";
import {
  validateChannelName,
  validateExcludeTypes,
  validateExcludeRegex,
} from "../utils/validation.js";
import { proxyItemImages } from "../media/proxy.js";
import { getDeckConfig, saveDeckConfig } from "../storage/deck.js";

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

  // Create feed subscription
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
    const channelsCollection = application.collections.get("microsub_channels");
    channel = await channelsCollection.findOne({ _id: itemDocument.channelId });
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

/**
 * Ensure value is a string URL
 * @param {string|object|undefined} value - Value to check
 * @returns {string|undefined} String value or undefined
 */
function ensureString(value) {
  if (!value) return;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value.url) return value.url;
  return String(value);
}

/**
 * Detect the protocol of a URL for auto-syndication targeting
 * @param {string} url - URL to classify
 * @returns {string} "atmosphere" | "fediverse" | "web"
 */
function detectProtocol(url) {
  if (!url || typeof url !== "string") return "web";
  const lower = url.toLowerCase();
  if (lower.includes("bsky.app") || lower.includes("bluesky")) return "atmosphere";
  if (lower.includes("mastodon.") || lower.includes("mstdn.") || lower.includes("fosstodon.") ||
      lower.includes("pleroma.") || lower.includes("misskey.") || lower.includes("pixelfed.")) return "fediverse";
  return "web";
}

/**
 * Fetch syndication targets from Micropub config
 * @param {object} application - Indiekit application
 * @param {string} token - Auth token
 * @returns {Promise<Array>} Syndication targets
 */
async function getSyndicationTargets(application, token) {
  try {
    const micropubEndpoint = application.micropubEndpoint;
    if (!micropubEndpoint) return [];

    const micropubUrl = micropubEndpoint.startsWith("http")
      ? micropubEndpoint
      : new URL(micropubEndpoint, application.url).href;

    const configUrl = `${micropubUrl}?q=config`;
    const configResponse = await fetch(configUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!configResponse.ok) return [];

    const config = await configResponse.json();
    return config["syndicate-to"] || [];
  } catch {
    return [];
  }
}

/**
 * Compose response form
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function compose(request, response) {
  const { application } = request.app.locals;

  // Support both long-form (replyTo) and short-form (reply) query params
  const {
    replyTo,
    reply,
    likeOf,
    like,
    repostOf,
    repost,
    bookmarkOf,
    bookmark,
  } = request.query;

  // Fetch syndication targets if user is authenticated
  const token = request.session?.access_token;
  const syndicationTargets = token
    ? await getSyndicationTargets(application, token)
    : [];

  // Auto-select syndication target based on interaction URL protocol
  const interactionUrl = ensureString(replyTo || reply || likeOf || like || repostOf || repost);
  if (interactionUrl && syndicationTargets.length > 0) {
    const protocol = detectProtocol(interactionUrl);
    for (const target of syndicationTargets) {
      const targetId = (target.uid || target.name || "").toLowerCase();
      if (protocol === "atmosphere" && (targetId.includes("bluesky") || targetId.includes("bsky"))) {
        target.checked = true;
      } else if (protocol === "fediverse" && (targetId.includes("mastodon") || targetId.includes("mstdn"))) {
        target.checked = true;
      }
    }
  }

  response.render("compose", {
    title: request.__("microsub.compose.title"),
    replyTo: ensureString(replyTo || reply),
    likeOf: ensureString(likeOf || like),
    repostOf: ensureString(repostOf || repost),
    bookmarkOf: ensureString(bookmarkOf || bookmark),
    syndicationTargets,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "channels",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Compose" },
    ],
  });
}

/**
 * Submit composed response via Micropub
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function submitCompose(request, response) {
  const { application } = request.app.locals;
  const { content } = request.body;
  const inReplyTo = request.body["in-reply-to"];
  const likeOf = request.body["like-of"];
  const repostOf = request.body["repost-of"];
  const bookmarkOf = request.body["bookmark-of"];
  const syndicateTo = request.body["mp-syndicate-to"];

  // Debug logging
  console.info(
    "[Microsub] submitCompose request.body:",
    JSON.stringify(request.body),
  );
  console.info("[Microsub] Extracted values:", {
    content,
    inReplyTo,
    likeOf,
    repostOf,
    bookmarkOf,
    syndicateTo,
  });

  // Get Micropub endpoint
  const micropubEndpoint = application.micropubEndpoint;
  if (!micropubEndpoint) {
    return response.status(500).render("error", {
      title: "Error",
      content: "Micropub endpoint not configured",
    });
  }

  // Build absolute Micropub URL
  const micropubUrl = micropubEndpoint.startsWith("http")
    ? micropubEndpoint
    : new URL(micropubEndpoint, application.url).href;

  // Get auth token from session
  const token = request.session?.access_token;
  if (!token) {
    return response.redirect("/session/login?redirect=" + request.originalUrl);
  }

  // Build Micropub request body
  const micropubData = new URLSearchParams();
  micropubData.append("h", "entry");

  if (likeOf) {
    // Like post - content is optional comment
    micropubData.append("like-of", likeOf);
    if (content && content.trim()) {
      micropubData.append("content", content.trim());
    }
  } else if (repostOf) {
    // Repost - content is optional comment
    micropubData.append("repost-of", repostOf);
    if (content && content.trim()) {
      micropubData.append("content", content.trim());
    }
  } else if (bookmarkOf) {
    // Bookmark - content is optional comment
    micropubData.append("bookmark-of", bookmarkOf);
    if (content && content.trim()) {
      micropubData.append("content", content.trim());
    }
  } else if (inReplyTo) {
    // Reply
    micropubData.append("in-reply-to", inReplyTo);
    micropubData.append("content", content || "");
  } else {
    // Regular note
    micropubData.append("content", content || "");
  }

  // Add syndication targets
  if (syndicateTo) {
    const targets = Array.isArray(syndicateTo) ? syndicateTo : [syndicateTo];
    for (const target of targets) {
      micropubData.append("mp-syndicate-to", target);
    }
  }

  // Debug: log what we're sending
  console.info("[Microsub] Sending to Micropub:", {
    url: micropubUrl,
    body: micropubData.toString(),
  });

  try {
    const micropubResponse = await fetch(micropubUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: micropubData.toString(),
    });

    if (
      micropubResponse.ok ||
      micropubResponse.status === 201 ||
      micropubResponse.status === 202
    ) {
      // Success - get the Location header for the new post URL
      const location = micropubResponse.headers.get("Location");
      console.info(
        `[Microsub] Created post via Micropub: ${location || "success"}`,
      );

      // Redirect back to reader with success message
      return response.redirect(`${request.baseUrl}/channels`);
    }

    // Handle error
    const errorBody = await micropubResponse.text();
    const statusText = micropubResponse.statusText || "Unknown error";
    console.error(
      `[Microsub] Micropub error: ${micropubResponse.status} ${errorBody}`,
    );

    // Parse error message from response body if JSON
    let errorMessage = `Micropub error: ${statusText}`;
    try {
      const errorJson = JSON.parse(errorBody);
      if (errorJson.error_description) {
        errorMessage = String(errorJson.error_description);
      } else if (errorJson.error) {
        errorMessage = String(errorJson.error);
      }
    } catch {
      // Not JSON, use status text
    }

    return response.status(micropubResponse.status).render("error", {
      title: "Error",
      content: errorMessage,
    });
  } catch (error) {
    console.error(`[Microsub] Micropub request failed: ${error.message}`);

    return response.status(500).render("error", {
      title: "Error",
      content: `Failed to create post: ${error.message}`,
    });
  }
}

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

  // Create feed subscription
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

/**
 * Actor profile — fetch and display a remote AP actor's recent posts
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
/**
 * Find the ActivityPub plugin instance from installed plugins.
 * @param {object} request - Express request
 * @returns {object|undefined} The AP plugin instance
 */
function getApPlugin(request) {
  const installedPlugins = request.app.locals.installedPlugins;
  if (!installedPlugins) return undefined;
  return [...installedPlugins].find(
    (p) => p.name === "ActivityPub endpoint",
  );
}

export async function actorProfile(request, response) {
  const actorUrl = request.query.url;
  if (!actorUrl) {
    return response.status(400).render("404");
  }

  // Check if we already follow this actor
  const { application } = request.app.locals;
  const apFollowing = application?.collections?.get("ap_following");
  let isFollowing = false;
  if (apFollowing) {
    const existing = await apFollowing.findOne({ actorUrl });
    isFollowing = !!existing;
  }

  // Check if AP plugin is available (for follow button visibility)
  const apPlugin = getApPlugin(request);
  const canFollow = !!apPlugin;

  try {
    const { actor, items } = await fetchActorOutbox(actorUrl, { limit: 30 });

    response.render("actor", {
      title: actor.name || "Actor",
      actor,
      items,
      actorUrl,
      isFollowing,
      canFollow,
      baseUrl: request.baseUrl,
      readerBaseUrl: request.baseUrl,
      activeView: "channels",
      breadcrumbs: [
        { text: "Reader", href: request.baseUrl },
        { text: actor.name || "Actor" },
      ],
    });
  } catch (error) {
    console.error(`[Microsub] Actor profile fetch failed: ${error.message}`);
    response.render("actor", {
      title: "Actor",
      actor: { name: actorUrl, url: actorUrl, photo: "", summary: "" },
      items: [],
      actorUrl,
      isFollowing,
      canFollow,
      baseUrl: request.baseUrl,
      readerBaseUrl: request.baseUrl,
      activeView: "channels",
      error: "Could not fetch this actor's profile. They may have restricted access.",
      breadcrumbs: [
        { text: "Reader", href: request.baseUrl },
        { text: "Actor" },
      ],
    });
  }
}

export async function followActorAction(request, response) {
  const { actorUrl, actorName } = request.body;
  if (!actorUrl) {
    return response.status(400).redirect(request.baseUrl + "/channels/activitypub");
  }

  const apPlugin = getApPlugin(request);
  if (!apPlugin) {
    console.error("[Microsub] Cannot follow: ActivityPub plugin not installed");
    return response.redirect(
      `${request.baseUrl}/actor?url=${encodeURIComponent(actorUrl)}`,
    );
  }

  const result = await apPlugin.followActor(actorUrl, { name: actorName });
  if (!result.ok) {
    console.error(`[Microsub] Follow via AP plugin failed: ${result.error}`);
  }

  return response.redirect(
    `${request.baseUrl}/actor?url=${encodeURIComponent(actorUrl)}`,
  );
}

export async function unfollowActorAction(request, response) {
  const { actorUrl } = request.body;
  if (!actorUrl) {
    return response.status(400).redirect(request.baseUrl + "/channels/activitypub");
  }

  const apPlugin = getApPlugin(request);
  if (!apPlugin) {
    console.error("[Microsub] Cannot unfollow: ActivityPub plugin not installed");
    return response.redirect(
      `${request.baseUrl}/actor?url=${encodeURIComponent(actorUrl)}`,
    );
  }

  const result = await apPlugin.unfollowActor(actorUrl);
  if (!result.ok) {
    console.error(`[Microsub] Unfollow via AP plugin failed: ${result.error}`);
  }

  return response.redirect(
    `${request.baseUrl}/actor?url=${encodeURIComponent(actorUrl)}`,
  );
}

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

  // Build channel lookup map (ObjectId string -> { name, color })
  const channelMap = new Map();
  for (const ch of channelList) {
    channelMap.set(ch._id.toString(), { name: ch.name, color: ch.color });
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
 * Deck view - TweetDeck-style columns
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function deck(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);

  const channelList = await getChannelsWithColors(application, userId);
  const deckConfig = await getDeckConfig(application, userId);

  // Determine which channels to show as columns
  let columnChannels;
  if (deckConfig?.columns?.length > 0) {
    // Use saved config order
    const channelMap = new Map(channelList.map((ch) => [ch._id.toString(), ch]));
    columnChannels = deckConfig.columns
      .map((col) => channelMap.get(col.channelId.toString()))
      .filter(Boolean);
  } else {
    // Default: all channels except notifications
    columnChannels = channelList.filter((ch) => ch.uid !== "notifications");
  }

  // Fetch items for each column (limited to 10 per column for performance)
  const proxyBaseUrl = application.url;
  const columns = await Promise.all(
    columnChannels.map(async (channel) => {
      const result = await getTimelineItems(application, channel._id, {
        userId,
        limit: 10,
      });

      if (proxyBaseUrl && result.items) {
        result.items = result.items.map((item) =>
          proxyItemImages(item, proxyBaseUrl),
        );
      }

      return {
        channel,
        items: result.items,
        paging: result.paging,
      };
    }),
  );

  // Set view preference cookie
  if (request.session) request.session.microsubView = "deck";

  response.render("deck", {
    title: "Deck",
    columns,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "deck",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Deck" },
    ],
  });
}

/**
 * Deck settings page
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function deckSettings(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);

  const channelList = await getChannelsWithColors(application, userId);
  const deckConfig = await getDeckConfig(application, userId);

  const selectedIds = deckConfig?.columns
    ? deckConfig.columns.map((col) => col.channelId.toString())
    : channelList.filter((ch) => ch.uid !== "notifications").map((ch) => ch._id.toString());

  response.render("deck-settings", {
    title: "Deck settings",
    channels: channelList,
    selectedIds,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "deck",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Deck", href: `${request.baseUrl}/deck` },
      { text: "Settings" },
    ],
  });
}

/**
 * Save deck settings
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function saveDeckSettings(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);

  let { columns } = request.body;
  if (!columns) columns = [];
  if (!Array.isArray(columns)) columns = [columns];

  await saveDeckConfig(application, userId, columns);

  response.redirect(`${request.baseUrl}/deck`);
}

export const readerController = {
  index,
  channels,
  newChannel,
  createChannel: createChannelAction,
  channel,
  settings,
  updateSettings,
  markAllRead,
  deleteChannel: deleteChannelAction,
  feeds,
  addFeed,
  removeFeed,
  feedDetails,
  editFeedForm,
  updateFeedUrl,
  rediscoverFeed,
  refreshFeed,
  item,
  compose,
  submitCompose,
  searchPage,
  searchFeeds,
  subscribe,
  actorProfile,
  followActorAction,
  unfollowActorAction,
  timeline,
  deck,
  deckSettings,
  saveDeckSettings,
};
