/**
 * Item filtering: exclude-types and exclude-regex predicates applied during
 * feed ingestion. Used by `lib/polling/processor.js` when deciding whether a
 * newly-parsed item should be stored.
 *
 * Historical note: this module previously also held mute/block storage
 * (microsub_muted / microsub_blocked operations). That code path was abandoned
 * — those collections are managed directly by `lib/controllers/mute.js` and
 * `lib/controllers/block.js` against MongoDB without an intermediate storage
 * helper layer. Only the per-channel exclude filters remain here.
 *
 * @module storage/filters
 */

/**
 * Check if an item passes the channel.settings.excludeTypes filter.
 * @param {object} item - Feed item
 * @param {object} settings - Channel settings
 * @returns {boolean} True when the item should be kept
 */
export function passesTypeFilter(item, settings) {
  if (!settings.excludeTypes || settings.excludeTypes.length === 0) {
    return true;
  }

  const itemType = detectInteractionType(item);
  return !settings.excludeTypes.includes(itemType);
}

/**
 * Check if an item passes the channel.settings.excludeRegex filter.
 * @param {object} item - Feed item
 * @param {object} settings - Channel settings
 * @returns {boolean} True when the item should be kept
 */
export function passesRegexFilter(item, settings) {
  if (!settings.excludeRegex) {
    return true;
  }

  try {
    const regex = new RegExp(settings.excludeRegex, "i");
    const searchText = [
      item.name,
      item.summary,
      item.content?.text,
      item.content?.html,
    ]
      .filter(Boolean)
      .join(" ");

    return !regex.test(searchText);
  } catch {
    // Invalid regex — skip the filter rather than rejecting every item.
    return true;
  }
}

/**
 * Classify an item by its interaction property. Internal helper for
 * passesTypeFilter — only its symbolic return value (one of "like" | "repost"
 * | "bookmark" | "reply" | "rsvp" | "checkin" | "post") is compared against
 * the excludeTypes list.
 *
 * Note: a similar but stricter classifier exists in `lib/utils/jf2.js` for
 * API-response shaping. The two cannot trivially be merged because this one
 * treats kebab-case keys only and emits a "post" default that the jf2 one
 * doesn't.
 *
 * @param {object} item - Feed item
 * @returns {string} Interaction type
 */
function detectInteractionType(item) {
  if (item["like-of"] && item["like-of"].length > 0) {
    return "like";
  }
  if (item["repost-of"] && item["repost-of"].length > 0) {
    return "repost";
  }
  if (item["bookmark-of"] && item["bookmark-of"].length > 0) {
    return "bookmark";
  }
  if (item["in-reply-to"] && item["in-reply-to"].length > 0) {
    return "reply";
  }
  if (item.rsvp) {
    return "rsvp";
  }
  if (item.checkin) {
    return "checkin";
  }

  return "post";
}
