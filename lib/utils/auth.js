/**
 * Authentication utilities for Microsub
 * @module utils/auth
 */

import { IndiekitError } from "@indiekit/error";

/**
 * Get the user ID from request context
 *
 * In Indiekit, the userId can come from:
 * 1. request.session.userId (if explicitly set)
 * 2. request.session.me (from token introspection)
 * 3. application.publication.me (single-user fallback)
 * @param {object} request - Express request
 * @returns {string|undefined} User ID
 */
export function getUserId(request) {
  // Check session for explicit userId
  if (request.session?.userId) {
    return request.session.userId;
  }

  // Check session for me URL from token introspection
  if (request.session?.me) {
    return request.session.me;
  }

  // Fall back to publication me URL (single-user mode)
  const { application } = request.app.locals;
  if (application?.publication?.me) {
    return application.publication.me;
  }

  // Final fallback: use "default" as user ID for single-user instances
  // This ensures read state is tracked even without explicit user identity
  return "default";
}

/**
 * Microsub scope each POST action needs. Every GET action reads.
 * @see https://indieweb.org/Microsub-spec#Authentication
 */
const POST_ACTION_SCOPES = {
  channels: "channels",
  timeline: "read", // mark_read, remove: changes read state only
  search: "read",
  preview: "read",
  follow: "follow",
  unfollow: "follow",
  mute: "mute",
  unmute: "mute",
  block: "block",
  unblock: "block",
};

/**
 * Scope Indiekit requests when the owner signs in to the admin UI
 * (`@indiekit/indiekit` lib/indieauth.js). It has no Microsub scopes, so
 * the reader UI, which calls this endpoint with that session, would
 * otherwise lock its own owner out.
 */
const OWNER_SESSION_SCOPES = ["create", "update", "delete", "media"];

/**
 * Check a space-separated scope string grants a scope (whole words only)
 * @param {string} [scope] - Granted scope(s)
 * @param {string} required - Required scope
 * @returns {boolean} Whether `required` is granted
 */
export function hasScope(scope, required) {
  return typeof scope === "string" && scope.split(/\s+/).includes(required);
}

/**
 * Scopes a request needs
 * @param {object} request - Express request
 * @returns {Array<string>} Required scopes
 */
function requiredScopes(request) {
  if (request.path.startsWith("/reader")) {
    // The reader UI reads, follows and manages channels
    return request.method === "GET" ? ["read"] : ["read", "follow", "channels"];
  }

  if (request.method === "GET") {
    return ["read"];
  }

  const action = request.body?.action || request.query?.action;
  const scope = POST_ACTION_SCOPES[action];
  return scope ? [scope] : []; // Unknown action: the dispatcher rejects it
}

/**
 * Refuse requests whose token lacks the Microsub scope for the action
 *
 * The owner's admin session is allowed as is: it holds every scope the
 * admin login asks for. A client token gets that far only if the owner
 * granted it full Micropub rights, and core already lets such a token
 * drive the whole admin UI.
 * ponytail: drop the owner fallback once core's login requests Microsub
 * scopes too.
 * @type {import("express").RequestHandler}
 */
export function requireScope(request, response, next) {
  const { scope } = request.session || {};

  const isOwnerSession = OWNER_SESSION_SCOPES.every((s) => hasScope(scope, s));
  const missing = requiredScopes(request).filter((s) => !hasScope(scope, s));

  if (isOwnerSession || missing.length === 0) {
    return next();
  }

  next(
    IndiekitError.insufficientScope(
      `Insufficient scope: requires ${missing.join(" ")}`,
      { scope: missing.join(" ") },
    ),
  );
}
