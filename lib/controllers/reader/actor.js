/**
 * ActivityPub actor profiles
 * @module controllers/reader/actor
 */

import { fetchActorOutbox } from "../../activitypub/outbox-fetcher.js";

const ACTOR_OUTBOX_LIMIT = 30;

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

/**
 * Actor profile — fetch and display a remote AP actor's recent posts
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
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
    const { actor, items } = await fetchActorOutbox(actorUrl, { limit: ACTOR_OUTBOX_LIMIT });

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

/**
 * Follow an ActivityPub actor
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
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

/**
 * Unfollow an ActivityPub actor
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
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
