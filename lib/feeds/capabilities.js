/**
 * Source capability detection
 * Detects what a feed source supports (webmention, micropub, platform API)
 * @module feeds/capabilities
 */

/**
 * Known Fediverse domain patterns
 */
const FEDIVERSE_PATTERNS = [
  "mastodon.",
  "mstdn.",
  "fosstodon.",
  "pleroma.",
  "misskey.",
  "pixelfed.",
  "fediverse",
];

/**
 * Detect the capabilities of a feed source
 * @param {string} feedUrl - The feed URL
 * @param {string} [siteUrl] - Optional site homepage URL (if different from feed)
 * @returns {Promise<object>} Capability profile
 */
export async function detectCapabilities(feedUrl, siteUrl) {
  const result = {
    source_type: "publication",
    webmention: null,
    micropub: null,
    platform_api: null,
    author_mode: "single",
    interactions: [],
    detected_at: new Date().toISOString(),
  };

  try {
    // 1. Pattern-match feed URL for known platforms
    const platformMatch = matchPlatform(feedUrl);
    if (platformMatch) {
      result.source_type = platformMatch.type;
      result.platform_api = platformMatch.api;
      result.interactions = platformMatch.interactions;
      return result;
    }

    // 2. Fetch site homepage and check for rel links
    const homepageUrl = siteUrl || deriveHomepage(feedUrl);
    if (homepageUrl) {
      const endpoints = await discoverEndpoints(homepageUrl);
      result.webmention = endpoints.webmention;
      result.micropub = endpoints.micropub;

      if (endpoints.webmention && endpoints.micropub) {
        result.source_type = "indieweb";
        result.interactions = ["reply", "like", "repost", "bookmark"];
      } else if (endpoints.webmention) {
        result.source_type = "web";
        result.interactions = ["reply"];
      }
    }
  } catch (error) {
    console.error(
      `[Microsub] Capability detection failed for ${feedUrl}:`,
      error.message,
    );
  }

  return result;
}

/**
 * Pattern-match a feed URL against known platforms
 * @param {string} url - Feed URL
 * @returns {object|null} Platform match or null
 */
function matchPlatform(url) {
  const lower = url.toLowerCase();

  // Bluesky
  if (lower.includes("bsky.app") || lower.includes("bluesky")) {
    return {
      type: "bluesky",
      api: { type: "atproto", authed: false },
      interactions: ["reply", "like", "repost"],
    };
  }

  // Mastodon / Fediverse RSS (e.g., mastodon.social/@user.rss)
  if (FEDIVERSE_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return {
      type: "mastodon",
      api: { type: "activitypub", authed: false },
      interactions: ["reply", "like", "repost"],
    };
  }

  // WordPress (common RSS patterns)
  if (lower.includes("/wp-json/") || lower.includes("/feed/")) {
    // Could be WordPress but also others — don't match too broadly
    // Only match the /wp-json/ pattern which is WordPress-specific
    if (lower.includes("/wp-json/")) {
      return {
        type: "wordpress",
        api: { type: "wp-rest", authed: false },
        interactions: ["reply"],
      };
    }
  }

  return null;
}

/**
 * Derive a homepage URL from a feed URL
 * @param {string} feedUrl - Feed URL
 * @returns {string|null} Homepage URL
 */
function deriveHomepage(feedUrl) {
  try {
    const url = new URL(feedUrl);
    return `${url.protocol}//${url.host}/`;
  } catch {
    return null;
  }
}

/**
 * Discover webmention and micropub endpoints from a URL
 * @param {string} url - URL to check for endpoint links
 * @returns {Promise<object>} Discovered endpoints
 */
async function discoverEndpoints(url) {
  const endpoints = {
    webmention: null,
    micropub: null,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html",
        "User-Agent": "Microsub/1.0 (+https://indieweb.org/Microsub)",
      },
      redirect: "follow",
    });

    if (!response.ok) return endpoints;

    // Check Link headers first
    const linkHeader = response.headers.get("link");
    if (linkHeader) {
      const wmMatch = linkHeader.match(
        /<([^>]+)>;\s*rel="?webmention"?/i,
      );
      if (wmMatch) endpoints.webmention = wmMatch[1];

      const mpMatch = linkHeader.match(
        /<([^>]+)>;\s*rel="?micropub"?/i,
      );
      if (mpMatch) endpoints.micropub = mpMatch[1];
    }

    // If not found in headers, check HTML
    if (!endpoints.webmention || !endpoints.micropub) {
      const html = await response.text();

      if (!endpoints.webmention) {
        const wmHtml = html.match(
          /<link[^>]+rel="?webmention"?[^>]+href="([^"]+)"/i,
        ) ||
          html.match(
            /<link[^>]+href="([^"]+)"[^>]+rel="?webmention"?/i,
          );
        if (wmHtml) endpoints.webmention = wmHtml[1];
      }

      if (!endpoints.micropub) {
        const mpHtml = html.match(
          /<link[^>]+rel="?micropub"?[^>]+href="([^"]+)"/i,
        ) ||
          html.match(
            /<link[^>]+href="([^"]+)"[^>]+rel="?micropub"?/i,
          );
        if (mpHtml) endpoints.micropub = mpHtml[1];
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      console.debug(
        `[Microsub] Endpoint discovery failed for ${url}:`,
        error.message,
      );
    }
  } finally {
    clearTimeout(timeout);
  }

  return endpoints;
}
