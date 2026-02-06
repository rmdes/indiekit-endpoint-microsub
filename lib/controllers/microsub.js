/**
 * Main Microsub action router
 * @module controllers/microsub
 */

import { IndiekitError } from "@indiekit/error";

import { validateAction } from "../utils/validation.js";

import { list as listBlocked, block, unblock } from "./block.js";
import { list as listChannels, action as channelAction } from "./channels.js";
import { stream as eventsStream } from "./events.js";
import { list as listFollows, follow, unfollow } from "./follow.js";
import { list as listMuted, mute, unmute } from "./mute.js";
import { get as getPreview, preview } from "./preview.js";
import { discover, search } from "./search.js";
import { get as getTimeline, action as timelineAction } from "./timeline.js";

/**
 * Route GET requests to appropriate action handler
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @param {Function} next - Express next function
 */
export async function get(request, response, next) {
  try {
    const { action } = request.query;

    // If no action provided, redirect to reader UI
    if (!action) {
      return response.redirect(request.baseUrl + "/reader");
    }

    validateAction(action);

    switch (action) {
      case "channels": {
        return listChannels(request, response);
      }

      case "timeline": {
        return getTimeline(request, response);
      }

      case "follow": {
        return listFollows(request, response);
      }

      case "preview": {
        return getPreview(request, response);
      }

      case "mute": {
        return listMuted(request, response);
      }

      case "block": {
        return listBlocked(request, response);
      }

      case "events": {
        return eventsStream(request, response);
      }

      case "search": {
        // Search is typically POST, but GET is allowed for feed discovery
        return discover(request, response);
      }

      default: {
        throw new IndiekitError(`Unsupported GET action: ${action}`, {
          status: 400,
        });
      }
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Route POST requests to appropriate action handler
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @param {Function} next - Express next function
 */
export async function post(request, response, next) {
  try {
    const action = request.body.action || request.query.action;
    validateAction(action);

    switch (action) {
      case "channels": {
        return channelAction(request, response);
      }

      case "timeline": {
        return timelineAction(request, response);
      }

      case "follow": {
        return follow(request, response);
      }

      case "unfollow": {
        return unfollow(request, response);
      }

      case "search": {
        return search(request, response);
      }

      case "preview": {
        return preview(request, response);
      }

      case "mute": {
        return mute(request, response);
      }

      case "unmute": {
        return unmute(request, response);
      }

      case "block": {
        return block(request, response);
      }

      case "unblock": {
        return unblock(request, response);
      }

      default: {
        throw new IndiekitError(`Unsupported POST action: ${action}`, {
          status: 400,
        });
      }
    }
  } catch (error) {
    next(error);
  }
}

export const microsubController = { get, post };
