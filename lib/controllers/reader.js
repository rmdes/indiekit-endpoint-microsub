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
      error: "Could not fetch this actor's profile. They may have restricted access.",
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
};
