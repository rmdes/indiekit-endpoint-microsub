/**
 * Webmention receiver
 * @module webmention/receiver
 */

import { getUserId } from "../utils/auth.js";

import { processWebmention } from "./processor.js";

/**
 * Receive a webmention
 * POST /microsub/webmention
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function receive(request, response) {
  const { source, target } = request.body;

  if (!source || !target) {
    return response.status(400).json({
      error: "invalid_request",
      error_description: "Missing source or target parameter",
    });
  }

  // Validate URLs
  try {
    new URL(source);
    new URL(target);
  } catch {
    return response.status(400).json({
      error: "invalid_request",
      error_description: "Invalid source or target URL",
    });
  }

  const { application } = request.app.locals;
  const userId = getUserId(request);

  // Return 202 Accepted immediately (processing asynchronously)
  response.status(202).json({
    status: "accepted",
    message: "Webmention queued for processing",
  });

  // Process webmention in background
  setImmediate(async () => {
    try {
      await processWebmention(application, source, target, userId);
    } catch (error) {
      console.error(`[Microsub] Error processing webmention: ${error.message}`);
    }
  });
}

export const webmentionReceiver = { receive };
