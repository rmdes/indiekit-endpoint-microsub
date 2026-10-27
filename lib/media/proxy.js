/**
 * Media proxy with caching
 * @module media/proxy
 */

import crypto from "node:crypto";
import dns from "node:dns/promises";
import { isIP } from "node:net";

import { getCache, setCache } from "../cache/redis.js";

const BLOCKED_HOSTNAMES = new Set(["localhost"]);
const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT = 30_000;

/**
 * Get the IPv4 address inside an IPv4-mapped IPv6 address.
 * `new URL()` normalises `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, so both
 * the dotted and the hex form must be recognised.
 * @param {string} ip - IPv6 address, lowercase
 * @returns {string|null} IPv4 address, or null if not IPv4-mapped
 */
function mappedIPv4(ip) {
  const match = ip.match(/^(?:0{0,4}:){0,4}:?(?:0{0,4}:)?ffff:(.+)$/);
  if (!match) return null;
  if (isIP(match[1]) === 4) return match[1];

  const hex = match[1].match(/^([\da-f]{1,4}):([\da-f]{1,4})$/);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/**
 * Check if an IP address is in a private/reserved range (SSRF protection)
 * @param {string} ip - IPv4 or IPv6 address
 * @returns {boolean} True if private/reserved, or not an IP address
 */
export function isPrivateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF)
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
    if (a >= 224) return true; // multicast, reserved, broadcast
    return false;
  }

  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    const v4 = mappedIPv4(lower);
    if (v4) return isPrivateIp(v4);
    if (lower === "::" || lower === "::1") return true; // unspecified, loopback
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
    return false;
  }

  return true;
}

/**
 * Check if a URL targets a private/internal address.
 * Resolves the hostname and checks every address it resolves to.
 * @param {string} urlString - URL to check
 * @returns {Promise<boolean>} True if the URL targets a private/internal address
 */
export async function isPrivateUrl(urlString) {
  try {
    const parsed = new URL(urlString);

    // Block non-HTTP protocols
    if (!["http:", "https:"].includes(parsed.protocol)) return true;

    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, ""); // "localhost." is localhost
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
      return true;
    }

    // Literal IP: no DNS needed
    if (isIP(hostname)) return isPrivateIp(hostname);

    const addresses = await dns.lookup(hostname, { all: true });
    return (
      addresses.length === 0 ||
      addresses.some(({ address }) => isPrivateIp(address))
    );
  } catch {
    return true; // Invalid URL or DNS failure: block as precaution
  }
}

/**
 * Fetch an untrusted URL, checking every redirect hop against private
 * addresses. Every outbound request to a URL from feeds, webmentions or
 * users goes through here.
 *
 * ponytail: the address is checked by its own DNS lookup, then fetch resolves
 * it again, so a rebinding DNS server can still answer differently in between.
 * Pin the checked address in an undici dispatcher (`connect.lookup`) if that
 * window matters.
 * @param {string} url - URL to fetch
 * @param {RequestInit} [options] - fetch options (`redirect` is ignored)
 * @returns {Promise<Response>} Response of the final, non-redirect hop
 */
export async function safeFetch(url, options = {}) {
  let current = url;
  let init = {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    ...options,
    redirect: "manual",
  };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (await isPrivateUrl(current)) {
      throw new Error(`Refusing to fetch private address ${current}`);
    }

    const response = await fetch(current, init);

    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return response;
    }

    await response.body?.cancel();
    current = new URL(location, current).href;

    // As fetch does: 303, and 301/302 after POST, continue as GET
    const { status } = response;
    if (status === 303 || ((status === 301 || status === 302) && init.method === "POST")) {
      init = { ...init, method: "GET", body: undefined };
    }
  }

  throw new Error(`Too many redirects fetching ${url}`);
}

const MAX_SIZE = 2 * 1024 * 1024; // 2MB max image size
const CACHE_TTL = 4 * 60 * 60; // 4 hours
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  // image/svg+xml intentionally excluded — SVGs can contain embedded JavaScript
]);

/**
 * Generate a hash for a URL to use as cache key
 * @param {string} url - Original image URL
 * @returns {string} URL-safe hash
 */
function hashUrl(url) {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
}

// Without SECRET, sign with a per-process key (as core does for sessions)
// rather than a public literal anyone could sign arbitrary URLs with.
const FALLBACK_SECRET = crypto.randomBytes(32).toString("hex");

/**
 * Generate HMAC signature for a media proxy URL
 * @param {string} url - Original image URL
 * @returns {string} HMAC hex signature (16 chars)
 */
function signProxyUrl(url) {
  const secret = process.env.SECRET || FALLBACK_SECRET;
  return crypto
    .createHmac("sha256", secret)
    .update(url)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Verify HMAC signature for a media proxy URL
 * @param {string} url - Original image URL
 * @param {string} sig - Submitted signature
 * @returns {boolean} Whether signature is valid
 */
function verifyProxySignature(url, sig) {
  if (!sig) return false;
  const expected = signProxyUrl(url);
  // Constant-time comparison
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/**
 * Get the proxied URL for an image
 * @param {string} baseUrl - Base URL of the Microsub endpoint
 * @param {string} originalUrl - Original image URL
 * @returns {string} Proxied URL
 */
function getProxiedUrl(baseUrl, originalUrl) {
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
  const sig = signProxyUrl(originalUrl);
  return `${baseUrl}/microsub/media/${hash}?url=${encodeURIComponent(originalUrl)}&sig=${sig}`;
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
async function fetchImage(redis, url) {
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
    const response = await safeFetch(url, {
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
  const { url, sig } = request.query;

  if (!url) {
    return response.status(400).send("Missing url parameter");
  }

  // Verify HMAC signature (prevents abuse as open proxy)
  if (!verifyProxySignature(url, sig)) {
    return response.status(403).send("Invalid proxy signature");
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
  if (await isPrivateUrl(url)) {
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
