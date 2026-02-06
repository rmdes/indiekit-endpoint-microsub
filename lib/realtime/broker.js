/**
 * Server-Sent Events broker
 * Manages SSE connections and event distribution
 * @module realtime/broker
 */

import { subscribeToChannel } from "../cache/redis.js";

/**
 * SSE Client connection
 * @typedef {object} SseClient
 * @property {object} response - Express response object
 * @property {string} userId - User ID
 * @property {Set<string>} channels - Subscribed channel IDs
 */

/** @type {Map<object, SseClient>} */
const clients = new Map();

/** @type {Map<string, object>} Map of userId to Redis subscriber */
const userSubscribers = new Map();

const PING_INTERVAL = 10_000; // 10 seconds

/**
 * Add a client to the broker
 * @param {object} response - Express response object
 * @param {string} userId - User ID
 * @param {object} application - Indiekit application
 * @returns {object} Client object
 */
export function addClient(response, userId, application) {
  const client = {
    response,
    userId,
    channels: new Set(),
    pingInterval: setInterval(() => {
      sendEvent(response, "ping", { timestamp: new Date().toISOString() });
    }, PING_INTERVAL),
  };

  clients.set(response, client);

  // Set up Redis subscription for this user if not already done
  setupUserSubscription(userId, application);

  return client;
}

/**
 * Remove a client from the broker
 * @param {object} response - Express response object
 */
export function removeClient(response) {
  const client = clients.get(response);
  if (client) {
    clearInterval(client.pingInterval);
    clients.delete(response);

    // Check if any other clients for this user
    const hasOtherClients = [...clients.values()].some(
      (c) => c.userId === client.userId,
    );
    if (!hasOtherClients) {
      // Could clean up Redis subscription here if needed
    }
  }
}

/**
 * Subscribe a client to a channel
 * @param {object} response - Express response object
 * @param {string} channelId - Channel ID
 */
export function subscribeClient(response, channelId) {
  const client = clients.get(response);
  if (client) {
    client.channels.add(channelId);
  }
}

/**
 * Unsubscribe a client from a channel
 * @param {object} response - Express response object
 * @param {string} channelId - Channel ID
 */
export function unsubscribeClient(response, channelId) {
  const client = clients.get(response);
  if (client) {
    client.channels.delete(channelId);
  }
}

/**
 * Send an event to a specific client
 * @param {object} response - Express response object
 * @param {string} event - Event name
 * @param {object} data - Event data
 */
export function sendEvent(response, event, data) {
  try {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Client disconnected
    removeClient(response);
  }
}

/**
 * Broadcast an event to all clients subscribed to a channel
 * @param {string} channelId - Channel ID
 * @param {string} event - Event name
 * @param {object} data - Event data
 */
export function broadcastToChannel(channelId, event, data) {
  for (const client of clients.values()) {
    if (client.channels.has(channelId)) {
      sendEvent(client.response, event, data);
    }
  }
}

/**
 * Broadcast an event to all clients for a user
 * @param {string} userId - User ID
 * @param {string} event - Event name
 * @param {object} data - Event data
 */
export function broadcastToUser(userId, event, data) {
  for (const client of clients.values()) {
    if (client.userId === userId) {
      sendEvent(client.response, event, data);
    }
  }
}

/**
 * Broadcast an event to all connected clients
 * @param {string} event - Event name
 * @param {object} data - Event data
 */
export function broadcastToAll(event, data) {
  for (const client of clients.values()) {
    sendEvent(client.response, event, data);
  }
}

/**
 * Set up Redis subscription for a user
 * @param {string} userId - User ID
 * @param {object} application - Indiekit application
 */
async function setupUserSubscription(userId, application) {
  if (userSubscribers.has(userId)) {
    return; // Already subscribed
  }

  const redis = application.redis;
  if (!redis) {
    return; // No Redis, skip real-time
  }

  // Create a duplicate connection for pub/sub
  const subscriber = redis.duplicate();
  userSubscribers.set(userId, subscriber);

  try {
    await subscribeToChannel(subscriber, `microsub:user:${userId}`, (data) => {
      handleRedisEvent(userId, data);
    });
  } catch {
    // Subscription failed, remove from map
    userSubscribers.delete(userId);
  }
}

/**
 * Handle event received from Redis
 * @param {string} userId - User ID
 * @param {object} data - Event data
 */
function handleRedisEvent(userId, data) {
  const { type, channelId, ...eventData } = data;

  switch (type) {
    case "new-item": {
      broadcastToUser(userId, "new-item", { channelId, ...eventData });
      break;
    }
    case "channel-update": {
      broadcastToUser(userId, "channel-update", { channelId, ...eventData });
      break;
    }
    case "unread-count": {
      broadcastToUser(userId, "unread-count", { channelId, ...eventData });
      break;
    }
    default: {
      // Unknown event type, broadcast as generic event
      broadcastToUser(userId, type, data);
    }
  }
}

/**
 * Get broker statistics
 * @returns {object} Statistics
 */
export function getStats() {
  const userCounts = new Map();
  for (const client of clients.values()) {
    const count = userCounts.get(client.userId) || 0;
    userCounts.set(client.userId, count + 1);
  }

  return {
    totalClients: clients.size,
    uniqueUsers: userCounts.size,
    userSubscribers: userSubscribers.size,
  };
}

/**
 * Clean up all connections
 */
export function cleanup() {
  for (const client of clients.values()) {
    clearInterval(client.pingInterval);
  }
  clients.clear();

  for (const subscriber of userSubscribers.values()) {
    try {
      subscriber.quit();
    } catch {
      // Ignore cleanup errors
    }
  }
  userSubscribers.clear();
}
