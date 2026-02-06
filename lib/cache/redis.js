/**
 * Redis caching utilities
 * @module cache/redis
 */

import Redis from "ioredis";

let redisClient;

/**
 * Get Redis client from application
 * @param {object} application - Indiekit application
 * @returns {object|undefined} Redis client or undefined
 */
export function getRedisClient(application) {
  // Check if Redis is already initialized on the application
  if (application.redis) {
    return application.redis;
  }

  // Check if we already created a client
  if (redisClient) {
    return redisClient;
  }

  // Check for Redis URL in config
  const redisUrl = application.config?.application?.redisUrl;
  if (redisUrl) {
    try {
      redisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        lazyConnect: true,
      });

      redisClient.on("error", (error) => {
        console.error("[Microsub] Redis error:", error.message);
      });

      redisClient.on("connect", () => {
        console.info("[Microsub] Redis connected");
      });

      // Connect asynchronously
      redisClient.connect().catch((error) => {
        console.warn("[Microsub] Redis connection failed:", error.message);
      });

      return redisClient;
    } catch (error) {
      console.warn("[Microsub] Failed to initialize Redis:", error.message);
    }
  }
}

/**
 * Get value from cache
 * @param {object} redis - Redis client
 * @param {string} key - Cache key
 * @returns {Promise<object|undefined>} Cached value or undefined
 */
export async function getCache(redis, key) {
  if (!redis) {
    return;
  }

  try {
    const value = await redis.get(key);
    if (value) {
      return JSON.parse(value);
    }
  } catch {
    // Ignore cache errors
  }
}

/**
 * Set value in cache
 * @param {object} redis - Redis client
 * @param {string} key - Cache key
 * @param {object} value - Value to cache
 * @param {number} [ttl] - Time to live in seconds
 * @returns {Promise<void>}
 */
export async function setCache(redis, key, value, ttl = 300) {
  if (!redis) {
    return;
  }

  try {
    const serialized = JSON.stringify(value);
    await (ttl
      ? redis.set(key, serialized, "EX", ttl)
      : redis.set(key, serialized));
  } catch {
    // Ignore cache errors
  }
}

/**
 * Delete value from cache
 * @param {object} redis - Redis client
 * @param {string} key - Cache key
 * @returns {Promise<void>}
 */
export async function deleteCache(redis, key) {
  if (!redis) {
    return;
  }

  try {
    await redis.del(key);
  } catch {
    // Ignore cache errors
  }
}

/**
 * Publish event to channel
 * @param {object} redis - Redis client
 * @param {string} channel - Channel name
 * @param {object} data - Event data
 * @returns {Promise<void>}
 */
export async function publishEvent(redis, channel, data) {
  if (!redis) {
    return;
  }

  try {
    await redis.publish(channel, JSON.stringify(data));
  } catch {
    // Ignore pub/sub errors
  }
}

/**
 * Subscribe to channel
 * @param {object} redis - Redis client (must be separate connection for pub/sub)
 * @param {string} channel - Channel name
 * @param {(data: object) => void} callback - Callback function for messages
 * @returns {Promise<void>}
 */
export async function subscribeToChannel(redis, channel, callback) {
  if (!redis) {
    return;
  }

  try {
    await redis.subscribe(channel);
    redis.on("message", (receivedChannel, message) => {
      if (receivedChannel === channel) {
        try {
          const data = JSON.parse(message);
          callback(data);
        } catch {
          callback(message);
        }
      }
    });
  } catch {
    // Ignore subscription errors
  }
}

/**
 * Cleanup Redis connection on shutdown
 */
export async function closeRedis() {
  if (redisClient) {
    try {
      await redisClient.quit();
      redisClient = undefined;
    } catch {
      // Ignore cleanup errors
    }
  }
}
