/**
 * WebSub subscriber
 * @module websub/subscriber
 */

import crypto from "node:crypto";

import { updateFeedWebsub } from "../storage/feeds.js";

const DEFAULT_LEASE_SECONDS = 86_400 * 7; // 7 days

/**
 * Subscribe to a WebSub hub
 * @param {object} application - Indiekit application
 * @param {object} feed - Feed document with websub.hub
 * @param {string} callbackUrl - Callback URL for this subscription
 * @returns {Promise<boolean>} Whether subscription was initiated
 */
export async function subscribe(application, feed, callbackUrl) {
  if (!feed.websub?.hub) {
    return false;
  }

  const topic = feed.websub.topic || feed.url;
  const secret = generateSecret();

  try {
    const response = await fetch(feed.websub.hub, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        "hub.mode": "subscribe",
        "hub.topic": topic,
        "hub.callback": callbackUrl,
        "hub.secret": secret,
        "hub.lease_seconds": String(DEFAULT_LEASE_SECONDS),
      }),
    });

    // 202 Accepted means subscription is pending verification
    // 204 No Content means subscription was immediately accepted
    if (response.status === 202 || response.status === 204) {
      // Store the secret for signature verification
      await updateFeedWebsub(application, feed._id, {
        hub: feed.websub.hub,
        topic,
        secret,
        pending: true,
      });
      return true;
    }

    console.error(
      `[Microsub] WebSub subscription failed: ${response.status} ${response.statusText}`,
    );
    return false;
  } catch (error) {
    console.error(`[Microsub] WebSub subscription error: ${error.message}`);
    return false;
  }
}

/**
 * Unsubscribe from a WebSub hub
 * @param {object} application - Indiekit application
 * @param {object} feed - Feed document with websub.hub
 * @param {string} callbackUrl - Callback URL for this subscription
 * @returns {Promise<boolean>} Whether unsubscription was initiated
 */
export async function unsubscribe(application, feed, callbackUrl) {
  if (!feed.websub?.hub) {
    return false;
  }

  const topic = feed.websub.topic || feed.url;

  try {
    const response = await fetch(feed.websub.hub, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        "hub.mode": "unsubscribe",
        "hub.topic": topic,
        "hub.callback": callbackUrl,
      }),
    });

    if (response.status === 202 || response.status === 204) {
      // Clear WebSub data from feed
      await updateFeedWebsub(application, feed._id, {
        hub: feed.websub.hub,
        topic,
        secret: undefined,
        leaseSeconds: undefined,
        pending: false,
      });
      return true;
    }

    return false;
  } catch (error) {
    console.error(`[Microsub] WebSub unsubscribe error: ${error.message}`);
    return false;
  }
}

/**
 * Generate a random secret for signature verification
 * @returns {string} Random hex string
 */
function generateSecret() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Verify WebSub signature
 * @param {string} signature - X-Hub-Signature header value
 * @param {Buffer|string} body - Request body
 * @param {string} secret - Subscription secret
 * @returns {boolean} Whether signature is valid
 */
export function verifySignature(signature, body, secret) {
  if (!signature || !secret) {
    return false;
  }

  // Signature format: sha1=<hex> or sha256=<hex>
  const [algorithm, hash] = signature.split("=");
  if (!algorithm || !hash) {
    return false;
  }

  // Normalize algorithm name
  const algo = algorithm.toLowerCase().replace("sha", "sha");

  try {
    const expectedHash = crypto
      .createHmac(algo, secret)
      .update(body)
      .digest("hex");

    // Use timing-safe comparison
    return crypto.timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(expectedHash, "hex"),
    );
  } catch {
    return false;
  }
}

/**
 * Check if a WebSub subscription is about to expire
 * @param {object} feed - Feed document
 * @param {number} [thresholdSeconds] - Seconds before expiry to consider "expiring"
 * @returns {boolean} Whether subscription is expiring soon
 */
export function isSubscriptionExpiring(feed, thresholdSeconds = 86_400) {
  if (!feed.websub?.expiresAt) {
    return false;
  }

  const expiresAt = new Date(feed.websub.expiresAt);
  const threshold = new Date(Date.now() + thresholdSeconds * 1000);

  return expiresAt <= threshold;
}

/**
 * Get callback URL for a feed
 * @param {string} baseUrl - Base URL of the Microsub endpoint
 * @param {string} feedId - Feed ID
 * @returns {string} Callback URL
 */
export function getCallbackUrl(baseUrl, feedId) {
  return `${baseUrl}/microsub/websub/${feedId}`;
}
