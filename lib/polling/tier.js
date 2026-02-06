/**
 * Adaptive tier-based polling algorithm
 * Based on Ekster's approach: https://github.com/pstuifzand/ekster
 *
 * Tier determines poll interval: interval = 2^tier minutes
 * - Tier 0: Every minute (active/new feeds)
 * - Tier 1: Every 2 minutes
 * - Tier 2: Every 4 minutes
 * - Tier 3: Every 8 minutes
 * - Tier 4: Every 16 minutes
 * - Tier 5: Every 32 minutes
 * - Tier 6: Every 64 minutes (~1 hour)
 * - Tier 7: Every 128 minutes (~2 hours)
 * - Tier 8: Every 256 minutes (~4 hours)
 * - Tier 9: Every 512 minutes (~8 hours)
 * - Tier 10: Every 1024 minutes (~17 hours)
 *
 * @module polling/tier
 */

const MIN_TIER = 0;
const MAX_TIER = 10;
const DEFAULT_TIER = 1;

/**
 * Get polling interval for a tier in milliseconds
 * @param {number} tier - Polling tier (0-10)
 * @returns {number} Interval in milliseconds
 */
export function getIntervalForTier(tier) {
  const clampedTier = Math.max(MIN_TIER, Math.min(MAX_TIER, tier));
  const minutes = Math.pow(2, clampedTier);
  return minutes * 60 * 1000;
}

/**
 * Get next fetch time based on tier
 * @param {number} tier - Polling tier
 * @returns {Date} Next fetch time
 */
export function getNextFetchTime(tier) {
  const interval = getIntervalForTier(tier);
  return new Date(Date.now() + interval);
}

/**
 * Calculate new tier after a fetch
 * @param {object} options - Options
 * @param {number} options.currentTier - Current tier
 * @param {boolean} options.hasNewItems - Whether new items were found
 * @param {number} options.consecutiveUnchanged - Consecutive fetches with no changes
 * @returns {object} New tier and metadata
 */
export function calculateNewTier(options) {
  const {
    currentTier = DEFAULT_TIER,
    hasNewItems,
    consecutiveUnchanged = 0,
  } = options;

  let newTier = currentTier;
  let newConsecutiveUnchanged = consecutiveUnchanged;

  if (hasNewItems) {
    // Reset unchanged counter
    newConsecutiveUnchanged = 0;

    // Decrease tier (more frequent) if we found new items
    if (currentTier > MIN_TIER) {
      newTier = currentTier - 1;
    }
  } else {
    // Increment unchanged counter
    newConsecutiveUnchanged = consecutiveUnchanged + 1;

    // Increase tier (less frequent) after consecutive unchanged fetches
    // The threshold increases with tier to prevent thrashing
    const threshold = Math.max(2, currentTier);
    if (newConsecutiveUnchanged >= threshold && currentTier < MAX_TIER) {
      newTier = currentTier + 1;
      // Reset counter after tier change
      newConsecutiveUnchanged = 0;
    }
  }

  return {
    tier: newTier,
    consecutiveUnchanged: newConsecutiveUnchanged,
    nextFetchAt: getNextFetchTime(newTier),
  };
}

/**
 * Get initial tier for a new feed subscription
 * @returns {object} Initial tier settings
 */
export function getInitialTier() {
  return {
    tier: MIN_TIER, // Start at tier 0 for immediate first fetch
    consecutiveUnchanged: 0,
    nextFetchAt: new Date(), // Fetch immediately
  };
}

/**
 * Determine if a feed is due for fetching
 * @param {object} feed - Feed document
 * @returns {boolean} Whether the feed should be fetched
 */
export function isDueForFetch(feed) {
  if (!feed.nextFetchAt) {
    return true;
  }

  return new Date(feed.nextFetchAt) <= new Date();
}

/**
 * Get human-readable description of polling interval
 * @param {number} tier - Polling tier
 * @returns {string} Description
 */
export function getTierDescription(tier) {
  const minutes = Math.pow(2, tier);

  if (minutes < 60) {
    return `every ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = minutes / 60;
  if (hours < 24) {
    return `every ${hours.toFixed(1)} hour${hours === 1 ? "" : "s"}`;
  }

  const days = hours / 24;
  return `every ${days.toFixed(1)} day${days === 1 ? "" : "s"}`;
}

export { MIN_TIER, MAX_TIER, DEFAULT_TIER };
