# CLAUDE.md - indiekit-endpoint-microsub

## Package Overview

`@rmdes/indiekit-endpoint-microsub` is a comprehensive Microsub social reader plugin for Indiekit. It implements the Microsub protocol for subscribing to feeds, organizing them into channels, and reading posts in a unified timeline interface. The plugin provides both a Microsub API endpoint (for compatible clients) and a built-in web-based reader UI.

**Package Name:** `@rmdes/indiekit-endpoint-microsub`
**Version:** 1.0.30
**Type:** ESM module
**Entry Point:** `index.js`

## Core Features

- **Microsub Protocol Implementation**: Full Microsub API (channels, timeline, follow/unfollow, mute/block, search, preview)
- **Web Reader UI**: Built-in Nunjucks-based reader interface with channel navigation, timeline view, and composition
- **Multi-Format Feed Support**: RSS, Atom, JSON Feed, h-feed (microformats), with fallback feed discovery
- **Real-Time Updates**: WebSub (PubSubHubbub) support for instant notifications
- **Adaptive Polling**: Tiered polling system (2 minutes to 17+ hours) based on feed update frequency
- **Read State Management**: Per-user read tracking with automatic cleanup (keeps last 30 read items per channel)
- **Feed Discovery**: Automatic discovery of feeds from websites (RSS/Atom link tags, JSON Feed, h-feed)
- **Webmention Receiving**: Accepts webmentions for posts in the timeline
- **Media Proxy**: Proxies external images through local endpoint for privacy and caching
- **Blogroll Integration**: Optionally syncs feed subscriptions with `@rmdes/indiekit-endpoint-blogroll`
- **Compose UI**: Post replies, likes, reposts, and bookmarks via Micropub

## Architecture

### Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    FEED INGESTION                            │
├──────────────────────────────────────────────────────────────┤
│ Scheduler (60s interval)                                     │
│   ↓                                                           │
│ getFeedsToFetch() → processFeedBatch()                       │
│   ↓                                                           │
│ fetchFeed() → parseFeed() → normalizeItems()                 │
│   ↓                                                           │
│ addItem() → MongoDB (dedup by uid)                           │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    READER UI                                 │
├──────────────────────────────────────────────────────────────┤
│ /microsub/reader/channels → List channels                    │
│ /microsub/reader/channels/:uid → Channel timeline            │
│ /microsub/reader/channels/:uid/feeds → Manage subscriptions  │
│ /microsub/reader/compose → Post via Micropub                 │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    MICROSUB API                              │
├──────────────────────────────────────────────────────────────┤
│ GET/POST /microsub?action=channels → Channel list            │
│ GET/POST /microsub?action=timeline → Timeline items          │
│ POST /microsub?action=follow → Subscribe to feed             │
│ POST /microsub?action=unfollow → Unsubscribe                 │
│ POST /microsub?action=mute/block → Filter content            │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    REAL-TIME UPDATES                         │
├──────────────────────────────────────────────────────────────┤
│ WebSub Hub → POST /microsub/websub/:id → processWebsubUpdate│
│ Webmention → POST /microsub/webmention → addNotification    │
└──────────────────────────────────────────────────────────────┘
```

## MongoDB Collections

### `microsub_channels`

Stores user channels for organizing feeds.

```javascript
{
  _id: ObjectId,
  uid: "unique-short-id",        // Generated 8-char alphanumeric
  name: "Technology",
  userId: "user-id",              // For multi-user support
  order: 0,                       // Display order
  settings: {
    excludeTypes: ["repost"],     // Filter by post type
    excludeRegex: "/spam|ads/i"   // Filter by regex
  },
  createdAt: "2026-02-13T...",
  updatedAt: "2026-02-13T..."
}
```

**Special Channel**: `uid: "notifications"` (order: -1, always first) receives webmentions and mentions.

**Indexes:**
- `{ uid: 1 }` - Unique channel lookup
- `{ userId: 1, order: 1 }` - Sorted channel list per user

### `microsub_feeds`

Stores feed subscriptions and polling metadata.

```javascript
{
  _id: ObjectId,
  channelId: ObjectId,            // References microsub_channels
  url: "https://example.com/feed",
  title: "Example Blog",
  photo: "https://example.com/icon.png",
  tier: 1,                        // Polling tier (0-10)
  unmodified: 0,                  // Consecutive unchanged fetches
  nextFetchAt: Date,              // When to poll next (kept as Date for query)
  lastFetchedAt: "2026-02-13T...", // ISO string
  status: "active" | "error",
  lastError: "HTTP 404",
  lastErrorAt: "2026-02-13T...",
  consecutiveErrors: 0,
  itemCount: 42,
  websub: {
    hub: "https://hub.example/",
    topic: "https://example.com/feed",
    secret: "random-secret",
    leaseSeconds: 432000,
    expiresAt: Date
  },
  createdAt: "2026-02-13T...",
  updatedAt: "2026-02-13T..."
}
```

**Polling Tiers:**
- Tier 0: 1 minute
- Tier 1: 2 minutes
- Tier 2: 4 minutes
- Tier 3: 8 minutes
- ...
- Tier 10: 1024 minutes (~17 hours)

**Tier Adjustment:**
- Content changed: tier - 1 (faster polling)
- Unchanged 2x: tier + 1 (slower polling)

**Indexes:**
- `{ channelId: 1, url: 1 }` - Prevent duplicate subscriptions
- `{ nextFetchAt: 1 }` - Scheduler query

### `microsub_items`

Stores timeline items (posts/entries).

```javascript
{
  _id: ObjectId,
  channelId: ObjectId,
  feedId: ObjectId,
  uid: "https://example.com/post/123", // Canonical URL or GUID
  type: "entry" | "event" | "review",
  url: "https://example.com/post/123",
  name: "Post Title",
  content: {
    text: "Plain text...",
    html: "<p>HTML content...</p>"
  },
  summary: "Short description",
  published: Date,                // Kept as Date for sorting
  updated: Date,
  author: {
    name: "Author Name",
    url: "https://author.example/",
    photo: "https://author.example/photo.jpg"
  },
  category: ["tag1", "tag2"],
  photo: ["https://example.com/img.jpg"],
  video: ["https://example.com/vid.mp4"],
  audio: ["https://example.com/aud.mp3"],
  likeOf: ["https://liked-post.example/"],
  repostOf: ["https://repost.example/"],
  bookmarkOf: ["https://bookmark.example/"],
  inReplyTo: ["https://reply-to.example/"],
  source: {                       // Metadata about feed source
    title: "Example Blog",
    url: "https://example.com"
  },
  readBy: ["user-id"],            // Array of user IDs who read this
  createdAt: "2026-02-13T..."
}
```

**Read State:** Items are marked read by adding userId to `readBy` array. Old read items are auto-deleted (keeps last 30 per channel).

**Indexes:**
- `{ channelId: 1, uid: 1 }` - Unique (prevents duplicates)
- `{ channelId: 1, published: -1 }` - Timeline queries
- `{ feedId: 1 }` - Feed-specific queries
- `{ channelId: 1, url: 1 }` - URL-based mark_read operations
- Text index on `name`, `content.text`, `content.html`, `summary`, `author.name`

### `microsub_notifications`

Special items collection for notifications channel (webmentions, mentions).

**Same schema as `microsub_items`**, stored in the notifications channel.

### `microsub_muted`

Muted URLs (hide posts from specific URLs).

```javascript
{
  _id: ObjectId,
  userId: "user-id",
  url: "https://muted-site.example/",
  createdAt: "2026-02-13T..."
}
```

### `microsub_blocked`

Blocked authors (delete all posts from author URL).

```javascript
{
  _id: ObjectId,
  userId: "user-id",
  authorUrl: "https://blocked-author.example/",
  createdAt: "2026-02-13T..."
}
```

## Key Files and Modules

### Core Entry Point

**`index.js`**
- Exports `MicrosubEndpoint` class
- Defines routes, navigation items, mount path
- Initializes MongoDB collections, scheduler, indexes, cleanup
- Registers public routes (WebSub, webmention, media proxy)

### Controllers

**`lib/controllers/microsub.js`**
- Main Microsub API dispatcher
- Routes GET/POST requests by `action` parameter
- Calls specialized controllers (channels, timeline, follow, mute, block, search, preview, events)

**`lib/controllers/reader.js`**
- Web UI controller for reader interface
- Channel management (list, create, delete, settings)
- Feed management (add, remove, edit, rediscover, refresh)
- Timeline rendering (pagination, read/unread filtering)
- Compose form (reply, like, repost, bookmark via Micropub)
- Search and discovery UI

**`lib/controllers/channels.js`**
- Microsub API: `action=channels`
- List, create, update, delete, reorder channels

**`lib/controllers/timeline.js`**
- Microsub API: `action=timeline`
- Get timeline items (paginated)
- Mark read/unread, remove items

**`lib/controllers/follow.js`**
- Microsub API: `action=follow`, `action=unfollow`
- Subscribe to feeds, unsubscribe
- Notifies blogroll plugin via `blogroll-notify.js`

**`lib/controllers/mute.js` / `block.js`**
- Microsub API: `action=mute`, `action=unmute`, `action=block`, `action=unblock`
- Mute URLs, block authors

**`lib/controllers/search.js`**
- Microsub API: `action=search`
- Feed discovery from URL

**`lib/controllers/preview.js`**
- Microsub API: `action=preview`
- Preview feed before subscribing

**`lib/controllers/events.js`**
- Microsub API: `action=events`
- Server-Sent Events (SSE) stream for real-time updates

**`lib/controllers/opml.js`**
- Export subscriptions as OPML

### Storage Layer

**`lib/storage/channels.js`**
- `createChannel()`, `getChannels()`, `getChannel()`, `updateChannel()`, `deleteChannel()`
- `reorderChannels()`, `updateChannelSettings()`
- `ensureNotificationsChannel()` - Auto-creates notifications channel

**`lib/storage/feeds.js`**
- `createFeed()`, `getFeedsForChannel()`, `getFeedById()`, `updateFeed()`, `deleteFeed()`
- `getFeedsToFetch()` - Returns feeds where `nextFetchAt <= now`
- `updateFeedAfterFetch()` - Adjusts tier based on content changes
- `updateFeedWebsub()` - Stores WebSub subscription data
- `updateFeedStatus()` - Tracks errors and health
- `getFeedsWithErrors()` - Admin diagnostics

**`lib/storage/items.js`**
- `addItem()` - Inserts item (dedup by `channelId + uid`)
- `getTimelineItems()` - Paginated timeline with before/after cursors
- `getItemById()`, `getItemsByUids()`
- `markItemsRead()`, `markItemsUnread()` - Per-user read state
- `removeItems()` - Delete items by ID/UID/URL
- `cleanupAllReadItems()` - Startup cleanup, keeps last 30 read per channel
- `createIndexes()` - Creates MongoDB indexes

**`lib/storage/filters.js`**
- `getMutedUrls()`, `addMutedUrl()`, `removeMutedUrl()`
- `getBlockedAuthors()`, `addBlockedAuthor()`, `removeBlockedAuthor()`

**`lib/storage/read-state.js`**
- `getReadState()`, `markRead()`, `markUnread()`
- Wraps `items.js` read operations

### Feed Processing

**`lib/feeds/parser.js`**
- `detectFeedType()` - Sniffs RSS/Atom/JSON Feed/h-feed from content
- `parseFeed()` - Dispatcher to format-specific parsers

**`lib/feeds/rss.js`**
- `parseRss()` - Parses RSS 2.0 and RSS 1.0 (RDF) using `feedparser`

**`lib/feeds/atom.js`**
- `parseAtom()` - Parses Atom feeds using `feedparser`

**`lib/feeds/jsonfeed.js`**
- `parseJsonFeed()` - Parses JSON Feed 1.x

**`lib/feeds/hfeed.js`**
- `parseHfeed()` - Parses h-feed microformats using `microformats-parser`

**`lib/feeds/normalizer.js`**
- `normalizeItem()` - Converts parsed items to jf2 format

**`lib/feeds/fetcher.js`**
- `fetchFeed()` - HTTP fetch with User-Agent, timeout, redirect handling

**`lib/feeds/discovery.js`**
- `discoverFeeds()` - Parses HTML `<link>` tags for RSS/Atom/JSON Feed
- `discoverAndValidateFeeds()` - Discovery + validation
- `getBestFeed()` - Prefers Atom > RSS > JSON Feed > h-feed

**`lib/feeds/validator.js`**
- `validateFeedUrl()` - Fetches and parses feed to ensure it's valid
- Detects comments feeds (WordPress/Mastodon post replies)

### Polling System

**`lib/polling/scheduler.js`**
- `startScheduler()` - Runs every 60 seconds, calls `runSchedulerCycle()`
- `stopScheduler()` - Cleanup on shutdown
- `refreshFeedNow()` - Manual feed refresh

**`lib/polling/processor.js`**
- `processFeed()` - Fetch, parse, add items for one feed
- `processFeedBatch()` - Concurrent processing (default 5 feeds at once)

**`lib/polling/tier.js`**
- `getTierInterval()` - Maps tier (0-10) to polling interval
- `adjustTier()` - Increases/decreases tier based on update frequency

### Real-Time Updates

**`lib/websub/discovery.js`**
- `discoverWebsubHub()` - Parses feed for `<link rel="hub">` or `<atom:link rel="hub">`

**`lib/websub/subscriber.js`**
- `subscribeToHub()` - Sends WebSub subscribe request to hub

**`lib/websub/handler.js`**
- `verify()` - Handles hub verification (GET /microsub/websub/:id)
- `receive()` - Handles content distribution (POST /microsub/websub/:id)

**`lib/webmention/receiver.js`**
- `receive()` - Accepts webmentions (POST /microsub/webmention)
- Adds to notifications channel

**`lib/webmention/verifier.js`**
- `verifyWebmention()` - Fetches source URL and confirms link to target

**`lib/webmention/processor.js`**
- `processWebmention()` - Parses source as h-entry, adds to notifications

### Media and Utilities

**`lib/media/proxy.js`**
- `handleMediaProxy()` - GET /microsub/media/:hash
- Fetches and caches external images, serves with correct Content-Type
- Hash is base64url(url)

**`lib/utils/auth.js`**
- `getUserId()` - Extracts user ID from session (defaults to "default" for single-user)

**`lib/utils/jf2.js`**
- `generateChannelUid()` - Random 8-char alphanumeric
- `convertToJf2()` - Transforms various formats to jf2

**`lib/utils/pagination.js`**
- `buildPaginationQuery()` - Cursor-based pagination (before/after)
- `generatePagingCursors()` - Returns `before` and `after` cursor strings

**`lib/utils/validation.js`**
- `validateChannelName()`, `validateAction()`, `validateExcludeTypes()`, `validateExcludeRegex()`

**`lib/utils/blogroll-notify.js`**
- `notifyBlogroll()` - Fire-and-forget notification to `@rmdes/indiekit-endpoint-blogroll`
- On follow: upserts blog entry with `source: "microsub"`
- On unfollow: soft-deletes blog entry

**`lib/cache/redis.js`**
- Optional Redis caching (not currently used in core)

**`lib/search/indexer.js` / `query.js`**
- Full-text search on items (uses MongoDB text index)

**`lib/realtime/broker.js`**
- SSE (Server-Sent Events) broker for real-time notifications

## Configuration

```javascript
import MicrosubEndpoint from "@rmdes/indiekit-endpoint-microsub";

export default {
  plugins: [
    new MicrosubEndpoint({
      mountPath: "/microsub", // Default
    }),
  ],
};
```

## Routes

### Protected (require auth)

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/microsub` | Microsub API endpoint (action parameter) |
| GET | `/microsub/reader` | Reader UI (redirects to channels) |
| GET | `/microsub/reader/channels` | List channels |
| GET | `/microsub/reader/channels/new` | New channel form |
| POST | `/microsub/reader/channels/new` | Create channel |
| GET | `/microsub/reader/channels/:uid` | Channel timeline |
| GET | `/microsub/reader/channels/:uid/settings` | Channel settings form |
| POST | `/microsub/reader/channels/:uid/settings` | Update settings |
| POST | `/microsub/reader/channels/:uid/delete` | Delete channel |
| GET | `/microsub/reader/channels/:uid/feeds` | List feeds in channel |
| POST | `/microsub/reader/channels/:uid/feeds` | Add feed to channel |
| POST | `/microsub/reader/channels/:uid/feeds/remove` | Remove feed |
| GET | `/microsub/reader/channels/:uid/feeds/:feedId/edit` | Edit feed form |
| POST | `/microsub/reader/channels/:uid/feeds/:feedId/edit` | Update feed URL |
| POST | `/microsub/reader/channels/:uid/feeds/:feedId/rediscover` | Run feed discovery |
| POST | `/microsub/reader/channels/:uid/feeds/:feedId/refresh` | Force refresh |
| GET | `/microsub/reader/item/:id` | Single item view |
| GET | `/microsub/reader/compose` | Compose form |
| POST | `/microsub/reader/compose` | Submit post via Micropub |
| GET | `/microsub/reader/search` | Search/discover feeds page |
| POST | `/microsub/reader/search` | Search feeds |
| POST | `/microsub/reader/subscribe` | Subscribe from search results |
| POST | `/microsub/reader/api/mark-read` | Mark all items read |
| GET | `/microsub/reader/opml` | Export OPML |

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/microsub/websub/:id` | WebSub verification |
| POST | `/microsub/websub/:id` | WebSub content distribution |
| POST | `/microsub/webmention` | Webmention receiver |
| GET | `/microsub/media/:hash` | Media proxy |

## Integration with Other Plugins

### Blogroll Plugin

When subscribing/unsubscribing to feeds, Microsub optionally notifies `@rmdes/indiekit-endpoint-blogroll`:

```javascript
// On follow
notifyBlogroll(application, "follow", {
  url: feedUrl,
  title: feedTitle,
  channelName: channel.name,
  feedId: feed._id,
  channelId: channel._id,
});

// On unfollow
notifyBlogroll(application, "unfollow", { url: feedUrl });
```

Blogroll stores feeds with `source: "microsub"` and soft-deletes on unfollow. If user explicitly deletes from blogroll, Microsub won't re-add.

### Micropub Plugin

Compose form posts via Micropub:

```javascript
// Fetch syndication targets from Micropub config
const micropubUrl = `${application.micropubEndpoint}?q=config`;
const config = await fetch(micropubUrl, {
  headers: { Authorization: `Bearer ${token}` }
});
const syndicationTargets = config["syndicate-to"];
```

Posts replies, likes, reposts, bookmarks:

```javascript
micropubData.append("h", "entry");
micropubData.append("in-reply-to", replyToUrl);
micropubData.append("content", content);
```

## Security Hardening (v1.0.30)

The following security fixes were applied in version 1.0.30 (commit 3c8a4b2):

### SSRF Protection in Media Proxy

**File:** `lib/media/proxy.js`

The media proxy (`/microsub/media/:hash`) previously accepted any URL, including internal network addresses. An attacker could craft a proxy URL targeting `http://localhost`, `http://127.0.0.1`, Docker internal IPs, or cloud metadata endpoints.

**Fix:** Added `isPrivateUrl()` blocklist that rejects URLs targeting:
- `localhost`, `127.x.x.x`, `::1` (loopback)
- `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x` (RFC 1918 private ranges)
- `169.254.x.x` (link-local/cloud metadata)

Also changed the error fallback from `response.redirect(url)` (open redirect) to `response.status(404).send("Image not available")`.

### ReDoS Prevention in Search

**File:** `lib/storage/items.js`

The `searchItems()` function built a regex from user input without escaping special characters. A crafted search query could cause catastrophic backtracking.

**Fix:** User input is escaped with `replaceAll(/[$()*+.?[\\\]^{|}]/g, "\\$&")` before building the regex.

### XSS Prevention in Webmention Content

**File:** `lib/webmention/verifier.js`

Webmention `content.html` was stored as-is from external sources. Malicious HTML could be stored and rendered to users.

**Fix:** Added `sanitize-html` with an allowlist of safe tags (`a`, `p`, `br`, `em`, `strong`, `blockquote`, `ul`, `ol`, `li`, `code`, `pre`) and safe attributes (`href` on `a` tags only). All other HTML is stripped before storage.

### Open Redirect Removal

**File:** `lib/media/proxy.js`

When the media proxy failed to fetch an image, it redirected the user to the original external URL. An attacker could use this as an open redirect.

**Fix:** Returns `404 "Image not available"` instead of redirecting.

## Known Gotchas

### Date Handling

**Rule**: Always store dates as ISO strings (`new Date().toISOString()`), EXCEPT `published` and `updated` in `microsub_items`, and `nextFetchAt` in `microsub_feeds`, which are kept as `Date` objects for MongoDB query compatibility.

```javascript
// CORRECT - stored as Date for query
{ published: new Date(timestamp) }

// CORRECT - converted to ISO string when sending to client
published: item.published?.toISOString()

// CORRECT - other timestamps as ISO strings
{ createdAt: new Date().toISOString() }
```

Templates use `| date("PPp")` filter which requires ISO strings, so `transformToJf2()` converts `published` Date to ISO before sending to templates.

### Read State Cleanup

Only the last 30 read items per channel are kept. Cleanup runs:
- On startup: `cleanupAllReadItems()`
- After marking items read: `cleanupOldReadItems()`

This prevents database bloat. Unread items are never deleted by cleanup.

### Feed Discovery Gotchas

- **ActivityPub JSON**: If a URL returns ActivityPub JSON (e.g., Mastodon profile), discovery throws an error suggesting the direct feed URL (e.g., `/feed/`)
- **Comments Feeds**: WordPress post comment feeds are detected and allowed but warned about (usually not what users want)
- **HTML Feeds**: h-feed discovery requires microformats2 markup

### Polling and WebSub

- Feeds with WebSub subscriptions are still polled (but less frequently)
- WebSub expires after `leaseSeconds` - plugin should re-subscribe (TODO: check if implemented)
- Tier adjustment only happens on successful fetch - errors don't change tier

### Media Proxy

Images are proxied through `/microsub/media/:hash` where hash is base64url(imageUrl). This:
- Hides user IP from origin servers
- Caches images locally
- Works around CORS and mixed-content issues

### Blogroll Integration

If a feed was explicitly deleted from blogroll (`status: "deleted"`), Microsub won't re-add it on follow. Delete and re-subscribe to override.

### Concurrent Processing

Scheduler processes 5 feeds concurrently by default. Increase `BATCH_CONCURRENCY` in `scheduler.js` for faster syncing (but watch memory/network usage).

## Dependencies

**Core:**
- `express` - Routing
- `feedparser` - RSS/Atom parsing
- `microformats-parser` - h-feed parsing
- `htmlparser2` - HTML parsing
- `sanitize-html` - XSS prevention
- `luxon` - Date handling

**Indiekit:**
- `@indiekit/error` - Error handling
- `@indiekit/frontend` - UI components
- `@indiekit/util` - Utilities (formatDate, etc.)

**Optional:**
- `ioredis` - Redis caching (not currently used)
- `debug` - Debug logging

## Testing and Debugging

**Enable debug logging:**
```bash
DEBUG=microsub:* npm start
```

**Check scheduler status:**
Scheduler runs every 60 seconds. Check logs for `[Microsub] Processing N feeds due for refresh`.

**Inspect feed errors:**
```javascript
const feeds = await getFeedsWithErrors(application, 3);
console.log(feeds.map(f => ({ url: f.url, error: f.lastError })));
```

**Manual feed refresh:**
```bash
POST /microsub/reader/channels/:uid/feeds/:feedId/refresh
```

**Clear read items:**
```javascript
await cleanupAllReadItems(application);
```

**Check WebSub subscriptions:**
```javascript
const feeds = await collection.find({ "websub.hub": { $exists: true } }).toArray();
```

## Common Issues

**Q: Feeds not updating?**
- Check `nextFetchAt` in `microsub_feeds` - may be in far future due to high tier
- Force refresh or rediscover feed from UI

**Q: Items disappearing after marking read?**
- Normal behavior - only last 30 read items kept per channel
- Adjust `MAX_READ_ITEMS` in `storage/items.js` if needed

**Q: "Unable to detect feed type" error?**
- Feed may be behind login wall
- Check if URL returns HTML instead of XML/JSON
- Try feed discovery from homepage URL

**Q: Duplicate items showing up?**
- Dedup is by `channelId + uid` - ensure feed provides stable GUIDs
- Check if feed URL changed (different feedId → new items)

**Q: WebSub not working?**
- Check hub discovery in feed XML: `<link rel="hub" href="..."/>`
- Verify callback URL is publicly accessible
- Check logs for hub verification failures

## Future Improvements

- WebSub lease renewal (currently expires after `leaseSeconds`)
- Redis caching for items (reduce MongoDB load)
- Full-text search UI (backend already implemented)
- SSE events stream UI (backend already implemented)
- OPML import (export already works)
- Microsub client compatibility testing (Indigenous, Monocle, etc.)
- Feed health dashboard (show error counts, last fetch times)
- Batch mark-read from timeline UI (currently channel-wide only)
