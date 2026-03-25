/**
 * Deck view
 * @module controllers/reader/deck
 */

import { getChannelsWithColors } from "../../storage/channels.js";
import { getTimelineItems } from "../../storage/items.js";
import { getDeckConfig, saveDeckConfig } from "../../storage/deck.js";
import { getUserId } from "../../utils/auth.js";
import { proxyItemImages } from "../../media/proxy.js";

/**
 * Deck view - TweetDeck-style columns
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function deck(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);

  const channelList = await getChannelsWithColors(application, userId);
  const deckConfig = await getDeckConfig(application, userId);

  // Determine which channels to show as columns
  let columnChannels;
  if (deckConfig?.columns?.length > 0) {
    // Use saved config order
    const channelMap = new Map(channelList.map((ch) => [ch._id.toString(), ch]));
    columnChannels = deckConfig.columns
      .map((col) => channelMap.get(col.channelId.toString()))
      .filter(Boolean);
  } else {
    // Default: all channels except notifications
    columnChannels = channelList.filter((ch) => ch.uid !== "notifications");
  }

  // Fetch items for each column (limited to 10 per column for performance)
  // Batch in groups of 4 to avoid overwhelming MongoDB with parallel queries
  const proxyBaseUrl = application.url;
  const columns = [];
  for (let i = 0; i < columnChannels.length; i += 4) {
    const batch = columnChannels.slice(i, i + 4);
    const batchResults = await Promise.all(
      batch.map(async (channel) => {
        const result = await getTimelineItems(application, channel._id, {
          userId,
          limit: 10,
        });

        if (proxyBaseUrl && result.items) {
          result.items = result.items.map((item) =>
            proxyItemImages(item, proxyBaseUrl),
          );
        }

        return {
          channel,
          items: result.items,
          paging: result.paging,
        };
      }),
    );
    columns.push(...batchResults);
  }

  // Set view preference cookie
  if (request.session) request.session.microsubView = "deck";

  response.render("deck", {
    title: "Deck",
    columns,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "deck",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Deck" },
    ],
  });
}

/**
 * Deck settings page
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function deckSettings(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);

  const channelList = await getChannelsWithColors(application, userId);
  const deckConfig = await getDeckConfig(application, userId);

  const selectedIds = deckConfig?.columns
    ? deckConfig.columns.map((col) => col.channelId.toString())
    : channelList.filter((ch) => ch.uid !== "notifications").map((ch) => ch._id.toString());

  response.render("deck-settings", {
    title: "Deck settings",
    channels: channelList,
    selectedIds,
    baseUrl: request.baseUrl,
    readerBaseUrl: request.baseUrl,
    activeView: "deck",
    breadcrumbs: [
      { text: "Reader", href: request.baseUrl },
      { text: "Deck", href: `${request.baseUrl}/deck` },
      { text: "Settings" },
    ],
  });
}

/**
 * Save deck settings
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function saveDeckSettings(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);

  let { columns } = request.body;
  if (!columns) columns = [];
  if (!Array.isArray(columns)) columns = [columns];

  await saveDeckConfig(application, userId, columns);

  response.redirect(`${request.baseUrl}/deck`);
}
