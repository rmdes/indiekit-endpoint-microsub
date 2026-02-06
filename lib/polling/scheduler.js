/**
 * Feed polling scheduler
 * @module polling/scheduler
 */

import { getFeedsToFetch } from "../storage/feeds.js";

import { processFeedBatch } from "./processor.js";

let schedulerInterval;
let indiekitInstance;
let isRunning = false;

const POLL_INTERVAL = 60 * 1000; // Run scheduler every minute
const BATCH_CONCURRENCY = 5; // Process 5 feeds at a time

/**
 * Start the feed polling scheduler
 * @param {object} indiekit - Indiekit instance
 */
export function startScheduler(indiekit) {
  if (schedulerInterval) {
    return; // Already running
  }

  indiekitInstance = indiekit;

  // Run every minute
  schedulerInterval = setInterval(async () => {
    await runSchedulerCycle();
  }, POLL_INTERVAL);

  // Run immediately on start
  runSchedulerCycle();

  console.log("[Microsub] Feed polling scheduler started");
}

/**
 * Stop the feed polling scheduler
 */
export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = undefined;
  }
  indiekitInstance = undefined;
  console.log("[Microsub] Feed polling scheduler stopped");
}

/**
 * Run a single scheduler cycle
 */
async function runSchedulerCycle() {
  if (!indiekitInstance) {
    return;
  }

  // Prevent overlapping runs
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    const application = indiekitInstance;
    const feeds = await getFeedsToFetch(application);

    if (feeds.length === 0) {
      isRunning = false;
      return;
    }

    console.log(`[Microsub] Processing ${feeds.length} feeds due for refresh`);

    const result = await processFeedBatch(application, feeds, {
      concurrency: BATCH_CONCURRENCY,
    });

    console.log(
      `[Microsub] Processed ${result.total} feeds: ${result.successful} successful, ` +
        `${result.failed} failed, ${result.itemsAdded} new items`,
    );

    // Log any errors
    for (const feedResult of result.results) {
      if (feedResult.error) {
        console.error(
          `[Microsub] Error processing ${feedResult.url}: ${feedResult.error}`,
        );
      }
    }
  } catch (error) {
    console.error("[Microsub] Error in scheduler cycle:", error.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Manually trigger a feed refresh
 * @param {object} application - Indiekit application
 * @param {string} feedId - Feed ID to refresh
 * @returns {Promise<object>} Processing result
 */
export async function refreshFeedNow(application, feedId) {
  const { getFeedById } = await import("../storage/feeds.js");
  const { processFeed } = await import("./processor.js");

  const feed = await getFeedById(application, feedId);
  if (!feed) {
    throw new Error("Feed not found");
  }

  return processFeed(application, feed);
}

/**
 * Get scheduler status
 * @returns {object} Scheduler status
 */
export function getSchedulerStatus() {
  return {
    running: !!schedulerInterval,
    processing: isRunning,
  };
}
