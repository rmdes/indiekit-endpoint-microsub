/**
 * Search controller
 * @module controllers/search
 */

import { IndiekitError } from "@indiekit/error";

import { discoverFeeds } from "../feeds/hfeed.js";
import { searchWithFallback } from "../search/query.js";
import { getChannel } from "../storage/channels.js";
import { getUserId } from "../utils/auth.js";
import { validateChannel, validateUrl } from "../utils/validation.js";

/**
 * Discover feeds from a URL
 * GET ?action=search&query=<url>
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function discover(request, response) {
  const { query } = request.query;

  if (!query) {
    throw new IndiekitError("Missing required parameter: query", {
      status: 400,
    });
  }

  // Check if query is a URL
  let url;
  try {
    url = new URL(query);
  } catch {
    // Not a URL, return empty results
    return response.json({ results: [] });
  }

  try {
    // Fetch the URL content
    const fetchResponse = await fetch(url.href, {
      headers: {
        Accept: "text/html, application/xhtml+xml, */*",
        "User-Agent": "Indiekit Microsub/1.0 (+https://getindiekit.com)",
      },
    });

    if (!fetchResponse.ok) {
      throw new IndiekitError(`Failed to fetch URL: ${fetchResponse.status}`, {
        status: 502,
      });
    }

    const content = await fetchResponse.text();
    const feeds = await discoverFeeds(content, url.href);

    // Transform to Microsub search result format
    const results = feeds.map((feed) => ({
      type: "feed",
      url: feed.url,
    }));

    response.json({ results });
  } catch (error) {
    if (error instanceof IndiekitError) {
      throw error;
    }
    throw new IndiekitError(`Feed discovery failed: ${error.message}`, {
      status: 502,
    });
  }
}

/**
 * Search feeds or items
 * POST ?action=search
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function search(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { query, channel } = request.body;

  if (!query) {
    throw new IndiekitError("Missing required parameter: query", {
      status: 400,
    });
  }

  // If channel is provided, search within channel items
  if (channel) {
    validateChannel(channel);

    const channelDocument = await getChannel(application, channel, userId);
    if (!channelDocument) {
      throw new IndiekitError("Channel not found", { status: 404 });
    }

    const items = await searchWithFallback(
      application,
      channelDocument._id,
      query,
    );
    return response.json({ items });
  }

  // Check if query is a URL (feed discovery)
  try {
    validateUrl(query, "query");

    // Use the discover function for URL queries
    const fetchResponse = await fetch(query, {
      headers: {
        Accept: "text/html, application/xhtml+xml, */*",
        "User-Agent": "Indiekit Microsub/1.0 (+https://getindiekit.com)",
      },
    });

    if (!fetchResponse.ok) {
      throw new IndiekitError(`Failed to fetch URL: ${fetchResponse.status}`, {
        status: 502,
      });
    }

    const content = await fetchResponse.text();
    const feeds = await discoverFeeds(content, query);

    const results = feeds.map((feed) => ({
      type: "feed",
      url: feed.url,
    }));

    return response.json({ results });
  } catch (error) {
    // Not a URL or fetch failed, return empty results
    if (error instanceof IndiekitError) {
      throw error;
    }
    return response.json({ results: [] });
  }
}

export const searchController = { discover, search };
