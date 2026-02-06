/**
 * Preview controller
 * @module controllers/preview
 */

import { IndiekitError } from "@indiekit/error";

import { fetchAndParseFeed } from "../feeds/fetcher.js";
import { validateUrl } from "../utils/validation.js";

const MAX_PREVIEW_ITEMS = 10;

/**
 * Fetch and preview a feed
 * @param {string} url - Feed URL
 * @returns {Promise<object>} Preview response
 */
async function fetchPreview(url) {
  try {
    const parsed = await fetchAndParseFeed(url);

    // Return feed metadata and sample items
    return {
      type: "feed",
      url: parsed.url,
      name: parsed.name,
      photo: parsed.photo,
      items: parsed.items.slice(0, MAX_PREVIEW_ITEMS),
    };
  } catch (error) {
    throw new IndiekitError(`Failed to preview feed: ${error.message}`, {
      status: 502,
    });
  }
}

/**
 * Preview a feed URL (GET)
 * GET ?action=preview&url=<feed>
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function get(request, response) {
  const { url } = request.query;

  validateUrl(url);

  const preview = await fetchPreview(url);
  response.json(preview);
}

/**
 * Preview a feed URL (POST)
 * POST ?action=preview
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function preview(request, response) {
  const { url } = request.body;

  validateUrl(url);

  const previewData = await fetchPreview(url);
  response.json(previewData);
}

export const previewController = { get, preview };
