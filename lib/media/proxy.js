/**
 * Media proxy with caching
 * @module media/proxy
 */

import crypto from "node:crypto";

import { getCache, setCache } from "../cache/redis.js";

/**
 * Private/internal IP ranges that should never be fetched (SSRF protection)
 */
const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0"]);
const BLOCKED_IP_PREFIXES = [
  "127.", // Loopback
  "10.", // Private Class A
  "192.168.", // Private Class C
  "169.254.", // Link-local
  "0.", // Current network
];

/**
 * Check if a hostname resolves to a private/internal address
 * @param {string} urlString - URL to check
 * @returns {boolean} True if the URL targets a private/internal address
 */
export function isPrivateUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname;

    // Block known private hostnames
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      return true;
    }

    // Block IPv6 loopback
    if (hostname === "::1" || hostname === "[::1]") {
      return true;
    }

    // Block private IPv4 ranges
    for (const prefix of BLOCKED_IP_PREFIXES) {
      if (hostname.startsWith(prefix)) {
        return true;
      }
    }

    // Block 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
    const match172 = hostname.match(/^172\.(\d+)\./);
    if (match172) {
      const second = Number.parseInt(match172[1], 10);
      if (second >= 16 && second <= 31) {
        return true;
      }
    }

    return false;
  } catch {
    return true; // Invalid URLs are blocked
  }
}

const MAX_SIZE = 2 * 1024 * 1024; // 2MB max image size
const CACHE_TTL = 4 * 60 * 60; // 4 hours
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/**
 * Generate a hash for a URL to use as cache key
 * @param {string} url - Original image URL
 * @returns {string} URL-safe hash
 */
export function hashUrl(url) {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/**
 * Get the proxied URL for an image
 * @param {string} baseUrl - Base URL of the Microsub endpoint
 * @param {string} originalUrl - Original image URL
 * @returns {string} Proxied URL
 */
export function getProxiedUrl(baseUrl, originalUrl) {
  if (!originalUrl || !baseUrl) {
    return originalUrl;
  }

  // Skip data URLs
  if (originalUrl.startsWith("data:")) {
    return originalUrl;
  }

  // Skip already-proxied URLs
  if (originalUrl.includes("/microsub/media/")) {
    return originalUrl;
  }

  const hash = hashUrl(originalUrl);
  return `${baseUrl}/microsub/media/${hash}?url=${encodeURIComponent(originalUrl)}`;
}

/**
 * Rewrite image URLs in an item to use the proxy
 * @param {object} item - JF2 item
 * @param {string} baseUrl - Base URL for proxy
 * @returns {object} Item with proxied URLs
 */
export function proxyItemImages(item, baseUrl) {
  if (!baseUrl || !item) {
    return item;
  }

  const proxied = { ...item };

  // Proxy photo URLs
  if (proxied.photo) {
    if (Array.isArray(proxied.photo)) {
      proxied.photo = proxied.photo.map((p) => {
        if (typeof p === "string") {
          return getProxiedUrl(baseUrl, p);
        }
        if (p?.value) {
          return { ...p, value: getProxiedUrl(baseUrl, p.value) };
        }
        return p;
      });
    } else if (typeof proxied.photo === "string") {
      proxied.photo = getProxiedUrl(baseUrl, proxied.photo);
    }
  }

  // Proxy author photo
  if (proxied.author?.photo) {
    proxied.author = {
      ...proxied.author,
      photo: getProxiedUrl(baseUrl, proxied.author.photo),
    };
  }

  return proxied;
}

/**
 * Fetch and cache an image
 * @param {object} redis - Redis client
 * @param {string} url - Image URL to fetch
 * @returns {Promise<object|null>} Cached image data or null
 */
export async function fetchImage(redis, url) {
  // Block private/internal URLs (defense-in-depth)
  if (isPrivateUrl(url)) {
    console.error(`[Microsub] Media proxy blocked private URL: ${url}`);
    return;
  }

  const cacheKey = `media:${hashUrl(url)}`;

  // Try cache first
  if (redis) {
    const cached = await getCache(redis, cacheKey);
    if (cached) {
      return cached;
    }
  }

  try {
    // Fetch the image
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Indiekit Microsub/1.0 (+https://getindiekit.com)",
        Accept: "image/*",
      },
      signal: AbortSignal.timeout(10_000), // 10 second timeout
    });

    if (!response.ok) {
      console.error(
        `[Microsub] Media proxy fetch failed: ${response.status} for ${url}`,
      );
      return;
    }

    // Check content type
    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (!ALLOWED_TYPES.has(contentType)) {
      console.error(
        `[Microsub] Media proxy rejected type: ${contentType} for ${url}`,
      );
      return;
    }

    // Check content length
    const contentLength = Number.parseInt(
      response.headers.get("content-length") || "0",
      10,
    );
    if (contentLength > MAX_SIZE) {
      console.error(
        `[Microsub] Media proxy rejected size: ${contentLength} for ${url}`,
      );
      return;
    }

    // Read the body
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_SIZE) {
      return;
    }

    const imageData = {
      contentType,
      data: Buffer.from(buffer).toString("base64"),
      size: buffer.byteLength,
    };

    // Cache in Redis
    if (redis) {
      await setCache(redis, cacheKey, imageData, CACHE_TTL);
    }

    return imageData;
  } catch (error) {
    console.error(`[Microsub] Media proxy error: ${error.message} for ${url}`);
    return;
  }
}

/**
 * Express route handler for media proxy
 * @param {object} request - Express request
 * @param {object} response - Express response
 * @returns {Promise<void>}
 */
export async function handleMediaProxy(request, response) {
  const { url } = request.query;

  if (!url) {
    return response.status(400).send("Missing url parameter");
  }

  // Validate URL
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return response.status(400).send("Invalid URL protocol");
    }
  } catch {
    return response.status(400).send("Invalid URL");
  }

  // Block requests to private/internal networks (SSRF protection)
  if (isPrivateUrl(url)) {
    return response.status(403).send("URL not allowed");
  }

  // Get Redis client from application
  const { application } = request.app.locals;
  const redis = application.redis;

  // Fetch or get from cache
  const imageData = await fetchImage(redis, url);

  if (!imageData) {
    return response.status(404).send("Image not available");
  }

  // Set cache headers
  response.set({
    "Content-Type": imageData.contentType,
    "Content-Length": imageData.size,
    "Cache-Control": "public, max-age=14400", // 4 hours
    "X-Proxied-From": url,
  });

  // Send the image
  response.send(Buffer.from(imageData.data, "base64"));
}
