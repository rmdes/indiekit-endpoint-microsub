/**
 * WebSub callback handler
 * @module websub/handler
 */

import { parseFeed } from "../feeds/parser.js";
import { processFeed } from "../polling/processor.js";
import { getFeedBySubscriptionId, updateFeedWebsub } from "../storage/feeds.js";

import { verifySignature } from "./subscriber.js";

/**
 * Verify WebSub subscription
 * GET /microsub/websub/:id
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function verify(request, response) {
  const { id } = request.params;
  const {
    "hub.topic": topic,
    "hub.challenge": challenge,
    "hub.lease_seconds": leaseSeconds,
  } = request.query;

  if (!challenge) {
    return response.status(400).send("Missing hub.challenge");
  }

  const { application } = request.app.locals;
  const feed = await getFeedBySubscriptionId(application, id);

  if (!feed) {
    return response.status(404).send("Subscription not found");
  }

  // Verify topic matches (allow both feed URL and topic URL)
  const expectedTopic = feed.websub?.topic || feed.url;
  if (topic !== feed.url && topic !== expectedTopic) {
    return response.status(400).send("Topic mismatch");
  }

  // Update lease seconds if provided
  if (leaseSeconds) {
    const seconds = Number.parseInt(leaseSeconds, 10);
    if (seconds > 0) {
      await updateFeedWebsub(application, id, {
        hub: feed.websub?.hub,
        topic: expectedTopic,
        leaseSeconds: seconds,
        secret: feed.websub?.secret,
      });
    }
  }

  // Mark subscription as active (not pending)
  if (feed.websub?.pending) {
    await updateFeedWebsub(application, id, {
      hub: feed.websub?.hub,
      topic: expectedTopic,
      secret: feed.websub?.secret,
      leaseSeconds: feed.websub?.leaseSeconds,
      pending: false,
    });
  }

  console.log(`[Microsub] WebSub subscription verified for ${feed.url}`);

  // Return challenge to verify subscription
  response.type("text/plain").send(challenge);
}

/**
 * Receive WebSub notification
 * POST /microsub/websub/:id
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function receive(request, response) {
  const { id } = request.params;
  const { application } = request.app.locals;

  const feed = await getFeedBySubscriptionId(application, id);
  if (!feed) {
    return response.status(404).send("Subscription not found");
  }

  // Verify X-Hub-Signature if we have a secret
  if (feed.websub?.secret) {
    const signature =
      request.headers["x-hub-signature-256"] ||
      request.headers["x-hub-signature"];

    if (!signature) {
      return response.status(401).send("Missing signature");
    }

    // Get raw body for signature verification
    const rawBody =
      typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body);

    if (!verifySignature(signature, rawBody, feed.websub.secret)) {
      console.warn(`[Microsub] Invalid WebSub signature for ${feed.url}`);
      return response.status(401).send("Invalid signature");
    }
  }

  // Acknowledge receipt immediately
  response.status(200).send("OK");

  // Process pushed content in background
  setImmediate(async () => {
    try {
      await processWebsubContent(
        application,
        feed,
        request.headers["content-type"],
        request.body,
      );
    } catch (error) {
      console.error(
        `[Microsub] Error processing WebSub content for ${feed.url}: ${error.message}`,
      );
    }
  });
}

/**
 * Process WebSub pushed content
 * @param {object} application - Indiekit application
 * @param {object} feed - Feed document
 * @param {string} contentType - Content-Type header
 * @param {string|object} body - Request body
 * @returns {Promise<void>}
 */
async function processWebsubContent(application, feed, contentType, body) {
  // Convert body to string if needed
  const content = typeof body === "string" ? body : JSON.stringify(body);

  try {
    // Parse the pushed content
    const parsed = await parseFeed(content, feed.url, { contentType });

    console.log(
      `[Microsub] Processing ${parsed.items.length} items from WebSub push for ${feed.url}`,
    );

    // Process like a normal feed fetch but with pre-parsed content
    // This reuses the existing feed processing logic
    await processFeed(application, {
      ...feed,
      _websubContent: parsed,
    });
  } catch (error) {
    console.error(
      `[Microsub] Failed to parse WebSub content for ${feed.url}: ${error.message}`,
    );
  }
}

export const websubHandler = { verify, receive };
