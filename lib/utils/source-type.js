/**
 * URL classification utilities
 * @module utils/source-type
 */

/**
 * Classify a URL by its platform/protocol
 * @param {string} url - URL to classify
 * @returns {{ type: string, protocol: string }}
 */
export function classifyUrl(url) {
  if (!url || typeof url !== "string") return { type: "web", protocol: "web" };
  const lower = url.toLowerCase();
  if (lower.includes("bsky.app") || lower.includes("bluesky")) {
    return { type: "bluesky", protocol: "atmosphere" };
  }
  if (
    lower.includes("mastodon.") ||
    lower.includes("mstdn.") ||
    lower.includes("fosstodon.") ||
    lower.includes("pleroma.") ||
    lower.includes("misskey.") ||
    lower.includes("pixelfed.")
  ) {
    return { type: "mastodon", protocol: "fediverse" };
  }
  return { type: "web", protocol: "web" };
}
