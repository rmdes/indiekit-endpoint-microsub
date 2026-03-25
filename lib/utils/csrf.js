/**
 * CSRF protection middleware for reader UI
 * Uses session-based tokens (not cookies)
 * @module utils/csrf
 */

import crypto from "node:crypto";

/**
 * Generate or retrieve CSRF token from session.
 * Exposes token as `response.locals.csrfToken` for templates.
 *
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @param {Function} next - Express next
 */
export function csrfToken(request, response, next) {
  if (request.session) {
    if (!request.session.csrfToken) {
      request.session.csrfToken = crypto.randomUUID();
    }
    response.locals.csrfToken = request.session.csrfToken;
  }
  next();
}

/**
 * Validate CSRF token on POST requests.
 * Checks `_csrf` field in body or `x-csrf-token` header.
 *
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @param {Function} next - Express next
 */
export function csrfValidate(request, response, next) {
  if (request.method !== "POST") return next();

  const sessionToken = request.session?.csrfToken;
  if (!sessionToken) {
    return response.status(403).send("CSRF token missing from session");
  }

  const submittedToken =
    request.body?._csrf || request.headers["x-csrf-token"];

  if (!submittedToken || submittedToken !== sessionToken) {
    return response.status(403).send("CSRF token invalid");
  }

  next();
}
