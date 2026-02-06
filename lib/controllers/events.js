/**
 * Server-Sent Events controller
 * @module controllers/events
 */

import {
  addClient,
  removeClient,
  sendEvent,
  subscribeClient,
} from "../realtime/broker.js";
import { getUserId } from "../utils/auth.js";

/**
 * SSE stream endpoint
 * GET ?action=events
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function stream(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);

  // Set SSE headers
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering

  // Flush headers immediately
  response.flushHeaders();

  // Add client to broker (handles ping internally)
  const client = addClient(response, userId, application);

  // Subscribe to channels from query parameter
  const { channels } = request.query;
  if (channels) {
    const channelList = Array.isArray(channels) ? channels : [channels];
    for (const channelId of channelList) {
      subscribeClient(response, channelId);
    }
  }

  // Send initial event
  sendEvent(response, "started", {
    version: "1.0.0",
    channels: [...client.channels],
  });

  // Handle client disconnect
  request.on("close", () => {
    removeClient(response);
  });
}

export const eventsController = { stream };
