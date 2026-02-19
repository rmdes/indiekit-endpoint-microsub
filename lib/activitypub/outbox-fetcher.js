/**
 * Fetch a remote ActivityPub actor's outbox for on-demand reading.
 * Returns ephemeral jf2 items — nothing is stored in MongoDB.
 *
 * @module activitypub/outbox-fetcher
 */

const AP_ACCEPT =
  'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';
const FETCH_TIMEOUT = 10_000;
const USER_AGENT = "Indiekit/1.0 (Microsub reader)";

/**
 * Fetch a remote actor's profile and recent posts from their outbox.
 *
 * @param {string} actorUrl - Full URL of the AP actor
 * @param {object} [options]
 * @param {number} [options.limit=20] - Max items to return
 * @returns {Promise<{ actor: object, items: Array }>}
 */
export async function fetchActorOutbox(actorUrl, options = {}) {
  const limit = options.limit || 20;

  // 1. Fetch actor profile
  const actor = await fetchJson(actorUrl);
  if (!actor || !actor.outbox) {
    throw new Error("Could not resolve actor or outbox URL");
  }

  const actorInfo = {
    name:
      actor.name ||
      actor.preferredUsername ||
      new URL(actorUrl).pathname.split("/").pop(),
    url: actor.url || actor.id || actorUrl,
    photo: actor.icon?.url || actor.icon || "",
    summary: stripHtml(actor.summary || ""),
    handle: actor.preferredUsername || "",
    followersCount: 0,
    followingCount: 0,
  };

  // Resolve follower/following counts if available
  if (typeof actor.followers === "string") {
    try {
      const followersCollection = await fetchJson(actor.followers);
      actorInfo.followersCount = followersCollection?.totalItems || 0;
    } catch {
      /* ignore */
    }
  }
  if (typeof actor.following === "string") {
    try {
      const followingCollection = await fetchJson(actor.following);
      actorInfo.followingCount = followingCollection?.totalItems || 0;
    } catch {
      /* ignore */
    }
  }

  // 2. Fetch outbox (OrderedCollection)
  const outboxUrl =
    typeof actor.outbox === "string" ? actor.outbox : actor.outbox?.id;
  const outbox = await fetchJson(outboxUrl);
  if (!outbox) {
    return { actor: actorInfo, items: [] };
  }

  // 3. Get items — may be inline or on a first page
  let activities = [];

  if (outbox.orderedItems?.length > 0) {
    activities = outbox.orderedItems;
  } else if (outbox.first) {
    const firstPageUrl =
      typeof outbox.first === "string" ? outbox.first : outbox.first?.id;
    if (firstPageUrl) {
      const firstPage = await fetchJson(firstPageUrl);
      activities = firstPage?.orderedItems || firstPage?.items || [];
    }
  }

  // 4. Convert Create activities to jf2 items
  const items = [];
  for (const activity of activities) {
    if (items.length >= limit) break;

    const item = activityToJf2(activity, actorInfo);
    if (item) items.push(item);
  }

  return { actor: actorInfo, items };
}

/**
 * Convert a single AP activity (or bare object) to jf2 format.
 * @param {object} activity - AP activity or object
 * @param {object} actorInfo - Actor profile info
 * @returns {object|null} jf2 item or null if not displayable
 */
function activityToJf2(activity, actorInfo) {
  // Unwrap Create/Announce — the displayable content is the inner object
  let object = activity;
  const activityType = activity.type;

  if (activityType === "Create" || activityType === "Announce") {
    object = activity.object;
    if (!object || typeof object === "string") return null; // Unresolved reference
  }

  // Skip non-content types (Follow, Like, etc.)
  const contentTypes = new Set([
    "Note",
    "Article",
    "Page",
    "Video",
    "Audio",
    "Image",
    "Event",
    "Question",
  ]);
  if (!contentTypes.has(object.type)) return null;

  const contentHtml = object.content || "";
  const contentText = stripHtml(contentHtml);

  const jf2 = {
    type: "entry",
    url: object.url || object.id || "",
    uid: object.id || object.url || "",
    name: object.name || undefined,
    content: contentHtml ? { text: contentText, html: contentHtml } : undefined,
    summary: object.summary ? stripHtml(object.summary) : undefined,
    published: object.published || activity.published || undefined,
    author: {
      name: actorInfo.name,
      url: actorInfo.url,
      photo: actorInfo.photo,
    },
    category: extractTags(object.tag),
    photo: extractMedia(object.attachment, "image"),
    video: extractMedia(object.attachment, "video"),
    audio: extractMedia(object.attachment, "audio"),
    _source: { type: "activitypub", actorUrl: actorInfo.url },
  };

  // Boost attribution
  if (activityType === "Announce" && activity.actor) {
    jf2._boostedBy = actorInfo;
    // The inner object may have its own author
    if (object.attributedTo) {
      const attributedUrl =
        typeof object.attributedTo === "string"
          ? object.attributedTo
          : object.attributedTo?.id || object.attributedTo?.url;
      if (attributedUrl) {
        jf2.author = {
          name:
            object.attributedTo?.name ||
            object.attributedTo?.preferredUsername ||
            attributedUrl,
          url: attributedUrl,
          photo: object.attributedTo?.icon?.url || "",
        };
      }
    }
  }

  if (object.inReplyTo) {
    const replyUrl =
      typeof object.inReplyTo === "string"
        ? object.inReplyTo
        : object.inReplyTo?.id;
    if (replyUrl) jf2["in-reply-to"] = [replyUrl];
  }

  return jf2;
}

/**
 * Extract hashtags from AP tag array.
 * @param {Array} tags - AP tag objects
 * @returns {Array<string>}
 */
function extractTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t) => t.type === "Hashtag" || t.type === "Tag")
    .map((t) => (t.name || "").replace(/^#/, ""))
    .filter(Boolean);
}

/**
 * Extract media URLs from AP attachment array.
 * @param {Array} attachments - AP attachment objects
 * @param {string} mediaPrefix - "image", "video", or "audio"
 * @returns {Array<string>}
 */
function extractMedia(attachments, mediaPrefix) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((a) => (a.mediaType || "").startsWith(`${mediaPrefix}/`))
    .map((a) => a.url || a.href || "")
    .filter(Boolean);
}

/**
 * Fetch a URL as ActivityPub JSON.
 * @param {string} url
 * @returns {Promise<object|null>}
 */
async function fetchJson(url) {
  if (!url) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: AP_ACCEPT,
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      console.warn(
        `[Microsub] AP fetch failed: ${response.status} for ${url}`,
      );
      return null;
    }

    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      console.warn(`[Microsub] AP fetch timeout for ${url}`);
    } else {
      console.warn(`[Microsub] AP fetch error for ${url}: ${error.message}`);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Strip HTML tags for plain text.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, "").trim();
}
