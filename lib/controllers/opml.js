/**
 * OPML export controller
 * @module controllers/opml
 */

import { getChannels } from "../storage/channels.js";
import { getFeedsForChannel } from "../storage/feeds.js";
import { getUserId } from "../utils/auth.js";

/**
 * Generate OPML export of all subscriptions
 * GET /opml
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
async function exportOpml(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);

  const channels = await getChannels(application, userId);

  // Build OPML structure
  const outlines = [];

  for (const channel of channels) {
    const feeds = await getFeedsForChannel(application, channel._id);

    if (feeds.length === 0) continue;

    const channelOutlines = feeds.map((feed) => ({
      text: feed.title || extractDomain(feed.url),
      title: feed.title || "",
      type: "rss",
      xmlUrl: feed.url,
      htmlUrl: deriveSiteUrl(feed.url),
    }));

    outlines.push({
      text: channel.name,
      title: channel.name,
      children: channelOutlines,
    });
  }

  const siteUrl = application.publication?.me || "https://example.com";
  const siteName = extractDomain(siteUrl);

  const opml = generateOpmlXml({
    title: `${siteName} - Microsub Subscriptions`,
    dateCreated: new Date().toUTCString(),
    ownerName: userId,
    outlines,
  });

  response.set("Content-Type", "text/x-opml");
  response.set(
    "Content-Disposition",
    'attachment; filename="subscriptions.opml"',
  );
  response.send(opml);
}

/**
 * Generate OPML XML from data
 * @param {object} data - OPML data
 * @param {string} data.title - Document title
 * @param {string} data.dateCreated - Creation date
 * @param {string} data.ownerName - Owner name
 * @param {Array} data.outlines - Outline items
 * @returns {string} OPML XML string
 */
function generateOpmlXml({ title, dateCreated, ownerName, outlines }) {
  const renderOutline = (outline, indent = "    ") => {
    if (outline.children) {
      const childrenXml = outline.children
        .map((child) => renderOutline(child, indent + "  "))
        .join("\n");
      return `${indent}<outline text="${escapeXml(outline.text)}" title="${escapeXml(outline.title)}">\n${childrenXml}\n${indent}</outline>`;
    }
    return `${indent}<outline text="${escapeXml(outline.text)}" title="${escapeXml(outline.title)}" type="${outline.type}" xmlUrl="${escapeXml(outline.xmlUrl)}" htmlUrl="${escapeXml(outline.htmlUrl)}"/>`;
  };

  const outlinesXml = outlines.map((o) => renderOutline(o)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXml(title)}</title>
    <dateCreated>${dateCreated}</dateCreated>
    <ownerName>${escapeXml(ownerName)}</ownerName>
  </head>
  <body>
${outlinesXml}
  </body>
</opml>`;
}

/**
 * Escape XML special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeXml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Extract domain from URL
 * @param {string} url - URL to extract domain from
 * @returns {string} Domain
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Derive site URL from feed URL
 * @param {string} feedUrl - Feed URL
 * @returns {string} Site URL
 */
function deriveSiteUrl(feedUrl) {
  try {
    const url = new URL(feedUrl);
    // Remove common feed paths
    const path = url.pathname
      .replace(/\/feed\/?$/, "")
      .replace(/\/rss\/?$/, "")
      .replace(/\/atom\.xml$/, "")
      .replace(/\/rss\.xml$/, "")
      .replace(/\/feed\.xml$/, "")
      .replace(/\/index\.xml$/, "")
      .replace(/\.rss$/, "")
      .replace(/\.atom$/, "");
    return `${url.origin}${path || "/"}`;
  } catch {
    return feedUrl;
  }
}

export const opmlController = { exportOpml };
