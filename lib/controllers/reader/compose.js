/**
 * Micropub compose
 * @module controllers/reader/compose
 */

import { classifyUrl } from "../../utils/source-type.js";

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

  // Auto-select syndication target based on interaction URL protocol
  const interactionUrl = ensureString(replyTo || reply || likeOf || like || repostOf || repost);
  if (interactionUrl && syndicationTargets.length > 0) {
    const protocol = classifyUrl(interactionUrl).protocol;
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
