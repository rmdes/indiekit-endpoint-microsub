/**
 * Webmention verification
 * @module webmention/verifier
 */

import { mf2 } from "microformats-parser";

/**
 * Verify a webmention
 * @param {string} source - Source URL
 * @param {string} target - Target URL
 * @returns {Promise<object>} Verification result
 */
export async function verifyWebmention(source, target) {
  try {
    // Fetch the source URL
    const response = await fetch(source, {
      headers: {
        Accept: "text/html, application/xhtml+xml",
        "User-Agent": "Indiekit Microsub/1.0 (+https://getindiekit.com)",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return {
        verified: false,
        error: `Source returned ${response.status}`,
      };
    }

    const content = await response.text();
    const finalUrl = response.url;

    // Check if source links to target
    if (!containsLink(content, target)) {
      return {
        verified: false,
        error: "Source does not link to target",
      };
    }

    // Parse microformats
    const parsed = mf2(content, { baseUrl: finalUrl });
    const entry = findEntry(parsed, target);

    if (!entry) {
      // Still valid, just no h-entry context
      return {
        verified: true,
        type: "mention",
        author: undefined,
        content: undefined,
      };
    }

    // Determine webmention type
    const mentionType = detectMentionType(entry, target);

    // Extract author
    const author = extractAuthor(entry, parsed);

    // Extract content
    const webmentionContent = extractContent(entry);

    return {
      verified: true,
      type: mentionType,
      author,
      content: webmentionContent,
      url: getFirst(entry.properties.url) || source,
      published: getFirst(entry.properties.published),
    };
  } catch (error) {
    return {
      verified: false,
      error: `Verification failed: ${error.message}`,
    };
  }
}

/**
 * Check if content contains a link to target
 * @param {string} content - HTML content
 * @param {string} target - Target URL to find
 * @returns {boolean} Whether the link exists
 */
function containsLink(content, target) {
  // Normalize target URL for matching
  const normalizedTarget = target.replace(/\/$/, "");

  // Check for href attribute containing target
  const hrefPattern = new RegExp(
    `href=["']${escapeRegex(normalizedTarget)}/?["']`,
    "i",
  );
  if (hrefPattern.test(content)) {
    return true;
  }

  // Also check without quotes (some edge cases)
  return content.includes(target) || content.includes(normalizedTarget);
}

/**
 * Find the h-entry that references the target
 * @param {object} parsed - Parsed microformats
 * @param {string} target - Target URL
 * @returns {object|undefined} The h-entry or undefined
 */
function findEntry(parsed, target) {
  const normalizedTarget = target.replace(/\/$/, "");

  for (const item of parsed.items) {
    // Check if this entry references the target
    if (
      item.type?.includes("h-entry") &&
      entryReferencesTarget(item, normalizedTarget)
    ) {
      return item;
    }

    // Check children
    if (item.children) {
      for (const child of item.children) {
        if (
          child.type?.includes("h-entry") &&
          entryReferencesTarget(child, normalizedTarget)
        ) {
          return child;
        }
      }
    }
  }

  // Return first h-entry as fallback
  for (const item of parsed.items) {
    if (item.type?.includes("h-entry")) {
      return item;
    }
  }

  return;
}

/**
 * Check if an entry references the target URL
 * @param {object} entry - h-entry object
 * @param {string} target - Normalized target URL
 * @returns {boolean} Whether the entry references the target
 */
function entryReferencesTarget(entry, target) {
  const properties = entry.properties || {};

  // Check interaction properties
  const interactionProperties = [
    "in-reply-to",
    "like-of",
    "repost-of",
    "bookmark-of",
  ];

  for (const property of interactionProperties) {
    const values = properties[property] || [];
    for (const value of values) {
      const url =
        typeof value === "string" ? value : value?.properties?.url?.[0];
      if (url && normalizeUrl(url) === target) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Detect the type of webmention
 * @param {object} entry - h-entry object
 * @param {string} target - Target URL
 * @returns {string} Mention type
 */
function detectMentionType(entry, target) {
  const properties = entry.properties || {};
  const normalizedTarget = target.replace(/\/$/, "");

  // Check for specific interaction types
  if (matchesTarget(properties["like-of"], normalizedTarget)) {
    return "like";
  }
  if (matchesTarget(properties["repost-of"], normalizedTarget)) {
    return "repost";
  }
  if (matchesTarget(properties["bookmark-of"], normalizedTarget)) {
    return "bookmark";
  }
  if (matchesTarget(properties["in-reply-to"], normalizedTarget)) {
    return "reply";
  }

  return "mention";
}

/**
 * Check if any value in array matches target
 * @param {Array} values - Array of values
 * @param {string} target - Target URL to match
 * @returns {boolean} Whether any value matches
 */
function matchesTarget(values, target) {
  if (!values || values.length === 0) return false;

  for (const value of values) {
    const url = typeof value === "string" ? value : value?.properties?.url?.[0];
    if (url && normalizeUrl(url) === target) {
      return true;
    }
  }

  return false;
}

/**
 * Extract author from entry or page
 * @param {object} entry - h-entry object
 * @param {object} parsed - Full parsed microformats
 * @returns {object|undefined} Author object
 */
function extractAuthor(entry, parsed) {
  const author = getFirst(entry.properties?.author);

  if (typeof author === "string") {
    return { name: author };
  }

  if (author?.type?.includes("h-card")) {
    return {
      type: "card",
      name: getFirst(author.properties?.name),
      url: getFirst(author.properties?.url),
      photo: getFirst(author.properties?.photo),
    };
  }

  // Try to find author from page's h-card
  const hcard = parsed.items.find((item) => item.type?.includes("h-card"));
  if (hcard) {
    return {
      type: "card",
      name: getFirst(hcard.properties?.name),
      url: getFirst(hcard.properties?.url),
      photo: getFirst(hcard.properties?.photo),
    };
  }

  return;
}

/**
 * Extract content from entry
 * @param {object} entry - h-entry object
 * @returns {object|undefined} Content object
 */
function extractContent(entry) {
  const content = getFirst(entry.properties?.content);

  if (!content) {
    const summary = getFirst(entry.properties?.summary);
    const name = getFirst(entry.properties?.name);
    return summary || name ? { text: summary || name } : undefined;
  }

  if (typeof content === "string") {
    return { text: content };
  }

  return {
    text: content.value,
    html: content.html,
  };
}

/**
 * Get first item from array
 * @param {Array|*} value - Value or array
 * @returns {*} First value
 */
function getFirst(value) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Normalize URL for comparison
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL
 */
function normalizeUrl(url) {
  return url.replace(/\/$/, "");
}

/**
 * Escape special regex characters
 * @param {string} string - String to escape
 * @returns {string} Escaped string
 */
function escapeRegex(string) {
  return string.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}
