/**
 * Notify blogroll plugin of Microsub follow/unfollow events
 * @module utils/blogroll-notify
 */

/**
 * Notify blogroll of a feed subscription change
 * Fire-and-forget — errors are logged but don't block the response
 * @param {object} application - Application instance
 * @param {string} action - "follow" or "unfollow"
 * @param {object} data - Feed data
 * @param {string} data.url - Feed URL
 * @param {string} [data.title] - Feed title
 * @param {string} [data.channelName] - Channel name
 * @param {string} [data.feedId] - Microsub feed ID
 * @param {string} [data.channelId] - Microsub channel ID
 */
export async function notifyBlogroll(application, action, data) {
  // Check if blogroll plugin is installed
  if (typeof application.getBlogrollDb !== "function") {
    return;
  }

  const db = application.getBlogrollDb();
  if (!db) {
    return;
  }

  const collection = db.collection("blogrollBlogs");
  const now = new Date();

  if (action === "follow") {
    // Skip if this feed was explicitly deleted by the user
    const deleted = await collection.findOne({
      feedUrl: data.url,
      status: "deleted",
    });
    if (deleted) {
      console.log(
        `[Microsub→Blogroll] Skipping follow for ${data.url} — previously deleted by user`,
      );
      return;
    }

    // Upsert the blog entry
    await collection.updateOne(
      { feedUrl: data.url },
      {
        $set: {
          title: data.title || extractDomain(data.url),
          siteUrl: extractSiteUrl(data.url),
          feedType: "rss",
          category: data.channelName || "Microsub",
          source: "microsub",
          microsubFeedId: data.feedId || null,
          microsubChannelId: data.channelId || null,
          microsubChannelName: data.channelName || null,
          skipItemFetch: true,
          status: "active",
          updatedAt: now,
        },
        $setOnInsert: {
          description: null,
          tags: [],
          photo: null,
          author: null,
          lastFetchAt: null,
          lastError: null,
          itemCount: 0,
          pinned: false,
          hidden: false,
          notes: null,
          createdAt: now,
        },
      },
      { upsert: true },
    );

    console.log(`[Microsub→Blogroll] Added/updated feed ${data.url}`);
  } else if (action === "unfollow") {
    // Soft-delete the blog entry if it came from microsub
    const result = await collection.updateOne(
      {
        feedUrl: data.url,
        source: "microsub",
        status: { $ne: "deleted" },
      },
      {
        $set: {
          status: "deleted",
          hidden: true,
          deletedAt: now,
          updatedAt: now,
        },
      },
    );

    if (result.modifiedCount > 0) {
      console.log(`[Microsub→Blogroll] Soft-deleted feed ${data.url}`);
    }
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function extractSiteUrl(feedUrl) {
  try {
    const parsed = new URL(feedUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}
