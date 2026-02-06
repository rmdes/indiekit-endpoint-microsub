/**
 * WebSub hub discovery
 * @module websub/discovery
 */

/**
 * Discover WebSub hub from HTTP response headers and content
 * @param {object} response - Fetch response object
 * @param {string} content - Response body content
 * @returns {object|undefined} WebSub info { hub, self }
 */
export function discoverWebsub(response, content) {
  // Try to find hub and self URLs from Link headers first
  const linkHeader = response.headers.get("link");
  const fromHeaders = linkHeader ? parseLinkHeader(linkHeader) : {};

  // Fall back to content parsing
  const fromContent = parseContentForLinks(content);

  const hub = fromHeaders.hub || fromContent.hub;
  const self = fromHeaders.self || fromContent.self;

  if (hub) {
    return { hub, self };
  }

  return;
}

/**
 * Parse Link header for hub and self URLs
 * @param {string} linkHeader - Link header value
 * @returns {object} { hub, self }
 */
function parseLinkHeader(linkHeader) {
  const result = {};
  const links = linkHeader.split(",");

  for (const link of links) {
    const parts = link.trim().split(";");
    if (parts.length < 2) continue;

    const urlMatch = parts[0].match(/<([^>]+)>/);
    if (!urlMatch) continue;

    const url = urlMatch[1];
    const relationship = parts
      .slice(1)
      .find((p) => p.trim().startsWith("rel="))
      ?.match(/rel=["']?([^"'\s;]+)["']?/)?.[1];

    if (relationship === "hub") {
      result.hub = url;
    } else if (relationship === "self") {
      result.self = url;
    }
  }

  return result;
}

/**
 * Parse content for hub and self URLs (Atom, RSS, HTML)
 * @param {string} content - Response body
 * @returns {object} { hub, self }
 */
function parseContentForLinks(content) {
  const result = {};

  // Try HTML <link> elements
  const htmlHubMatch = content.match(
    /<link[^>]+rel=["']?hub["']?[^>]+href=["']([^"']+)["']/i,
  );
  if (htmlHubMatch) {
    result.hub = htmlHubMatch[1];
  }

  const htmlSelfMatch = content.match(
    /<link[^>]+rel=["']?self["']?[^>]+href=["']([^"']+)["']/i,
  );
  if (htmlSelfMatch) {
    result.self = htmlSelfMatch[1];
  }

  // Also try the reverse order (href before rel)
  if (!result.hub) {
    const htmlHubMatch2 = content.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']?hub["']?/i,
    );
    if (htmlHubMatch2) {
      result.hub = htmlHubMatch2[1];
    }
  }

  if (!result.self) {
    const htmlSelfMatch2 = content.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']?self["']?/i,
    );
    if (htmlSelfMatch2) {
      result.self = htmlSelfMatch2[1];
    }
  }

  // Try Atom <link> elements
  if (!result.hub) {
    const atomHubMatch = content.match(
      /<atom:link[^>]+rel=["']?hub["']?[^>]+href=["']([^"']+)["']/i,
    );
    if (atomHubMatch) {
      result.hub = atomHubMatch[1];
    }
  }

  return result;
}

/**
 * Check if a hub URL is valid
 * @param {string} hubUrl - Hub URL to validate
 * @returns {boolean} Whether the URL is valid
 */
export function isValidHubUrl(hubUrl) {
  try {
    const url = new URL(hubUrl);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
