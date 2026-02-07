/**
 * Reader UI controller
 * @module controllers/reader
 */

import { discoverAndValidateFeeds } from "../feeds/discovery.js";
import { validateFeedUrl } from "../feeds/validator.js";
import { refreshFeedNow } from "../polling/scheduler.js";
import {
  getChannels,
  getChannel,
  createChannel,
  updateChannelSettings,
  deleteChannel,
} from "../storage/channels.js";
import {
  getFeedsForChannel,
  createFeed,
  deleteFeed,
} from "../storage/feeds.js";
import {
  getTimelineItems,
  getItemById,
  markItemsRead,
  countReadItems,
} from "../storage/items.js";
import { getUserId } from "../utils/auth.js";
import {
  validateChannelName,
  validateExcludeTypes,
  validateExcludeRegex,
} from "../utils/validation.js";

/**
 * Reader index - redirect to channels
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function index(request, response) {
  response.redirect(`${request.baseUrl}/channels`);
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

  response.render("reader", {
    title: request.__("microsub.reader.title"),
    channels: channelList,
    baseUrl: request.baseUrl,
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

  // Don't allow deleting notifications channel
  if (uid === "notifications") {
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

  response.render("item", {
    title: itemDocument.name || "Item",
    item: itemDocument,
    channel,
    baseUrl: request.baseUrl,
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

  response.render("compose", {
    title: request.__("microsub.compose.title"),
    replyTo: ensureString(replyTo || reply),
    likeOf: ensureString(likeOf || like),
    repostOf: ensureString(repostOf || repost),
    bookmarkOf: ensureString(bookmarkOf || bookmark),
    syndicationTargets,
    baseUrl: request.baseUrl,
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
  item,
  compose,
  submitCompose,
  searchPage,
  searchFeeds,
  subscribe,
};
