# @rmdes/indiekit-endpoint-microsub

A comprehensive Microsub social reader plugin for Indiekit. Subscribe to feeds (RSS, Atom, JSON Feed, h-feed), organize them into channels, and read posts in a unified timeline interface with a built-in web reader UI.

## Features

- **Microsub Protocol**: Full implementation of the [Microsub spec](https://indieweb.org/Microsub)
- **Multi-Format Feeds**: RSS, Atom, JSON Feed, h-feed (microformats)
- **Smart Polling**: Adaptive tiered polling (2 minutes to 17+ hours) based on update frequency
- **Real-Time Updates**: WebSub (PubSubHubbub) support for instant notifications
- **Web Reader UI**: Built-in reader interface with channel navigation and timeline view
- **Feed Discovery**: Automatic discovery of feeds from website URLs
- **Read State**: Per-user read tracking with automatic cleanup
- **Compose Interface**: Post replies, likes, reposts, and bookmarks via Micropub
- **Webmention Support**: Receive webmentions in your notifications channel
- **Media Proxy**: Privacy-friendly image proxying
- **OPML Export**: Export your subscriptions as OPML

## Installation

```bash
npm install @rmdes/indiekit-endpoint-microsub
```

## Configuration

Add to your Indiekit config:

```javascript
import MicrosubEndpoint from "@rmdes/indiekit-endpoint-microsub";

export default {
  plugins: [
    new MicrosubEndpoint({
      mountPath: "/microsub", // Default mount path
    }),
  ],
};
```

## Usage

### Web Reader UI

Navigate to `/microsub/reader` in your Indiekit installation to access the web interface.

**Channels**: Organize feeds into channels (Technology, News, Friends, etc.)
- Create new channels
- Configure content filters (exclude types, regex patterns)
- Reorder channels

**Feeds**: Manage subscriptions within each channel
- Subscribe to feeds by URL
- Search and discover feeds from websites
- Edit or rediscover feed URLs
- Force refresh feeds
- View feed health status

**Timeline**: Read posts from subscribed feeds
- Paginated timeline view
- Mark individual items or all items as read
- View read items separately
- Click through to original posts

**Compose**: Create posts via Micropub
- Reply to posts
- Like posts
- Repost posts
- Bookmark posts
- Include syndication targets

### Microsub API

Compatible with Microsub clients like [Indigenous](https://indigenous.realize.be/) and [Monocle](https://monocle.p3k.io/).

**Endpoint:** Your Indiekit URL + `/microsub`

**Supported Actions:**
- `channels` - List, create, update, delete, reorder channels
- `timeline` - Get timeline items (paginated)
- `follow` - Subscribe to a feed
- `unfollow` - Unsubscribe from a feed
- `mute` - Mute URLs
- `unmute` - Unmute URLs
- `block` - Block authors
- `unblock` - Unblock authors
- `search` - Discover feeds from URL
- `preview` - Preview feed before subscribing

**Example:**

```bash
# List channels
curl "https://your-site.example/microsub?action=channels" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Get timeline for channel
curl "https://your-site.example/microsub?action=timeline&channel=CHANNEL_UID" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Subscribe to feed
curl "https://your-site.example/microsub" \
  -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d "action=follow&channel=CHANNEL_UID&url=https://example.com/feed"
```

## Feed Polling

Feeds are polled using an adaptive tiered system:

- **Tier 0**: 1 minute (very active feeds)
- **Tier 1**: 2 minutes (active feeds)
- **Tier 2**: 4 minutes
- **Tier 3**: 8 minutes
- ...
- **Tier 10**: ~17 hours (inactive feeds)

Tiers adjust automatically:
- Feed updates → decrease tier (faster polling)
- No changes for 2+ fetches → increase tier (slower polling)

WebSub-enabled feeds receive instant updates when available.

## Read State Management

Read items are tracked per user. To prevent database bloat, only the last 30 read items per channel are kept. Unread items are never deleted.

Cleanup runs automatically:
- On server startup
- After marking items read

## Integration with Other Plugins

### Blogroll Plugin

If `@rmdes/indiekit-endpoint-blogroll` is installed, Microsub will automatically sync feed subscriptions:
- Subscribe to feed → adds to blogroll
- Unsubscribe → soft-deletes from blogroll

### Micropub Plugin

The compose interface posts via Micropub. Ensure `@indiekit/endpoint-micropub` is configured.

## OPML Export

Export your subscriptions:

```
GET /microsub/reader/opml
```

Returns OPML XML with all subscribed feeds organized by channel.

## Webmentions

The plugin accepts webmentions at `/microsub/webmention`. Received webmentions appear in the special "Notifications" channel.

To advertise your webmention endpoint, add to your site's `<head>`:

```html
<link rel="webmention" href="https://your-site.example/microsub/webmention" />
```

## Media Proxy

External images are proxied through `/microsub/media/:hash` for privacy and caching. This prevents your IP address from being sent to third-party image hosts.

## API Response Format

All API responses follow the Microsub spec. Timeline items use the [jf2 format](https://jf2.spec.indieweb.org/).

**Example timeline response:**

```json
{
  "items": [
    {
      "type": "entry",
      "uid": "https://example.com/post/123",
      "url": "https://example.com/post/123",
      "published": "2026-02-13T12:00:00.000Z",
      "name": "Post Title",
      "content": {
        "text": "Plain text content",
        "html": "<p>HTML content</p>"
      },
      "author": {
        "name": "Author Name",
        "url": "https://author.example/",
        "photo": "https://author.example/photo.jpg"
      },
      "_id": "507f1f77bcf86cd799439011",
      "_is_read": false
    }
  ],
  "paging": {
    "after": "cursor-string"
  }
}
```

## Database Collections

The plugin creates these MongoDB collections:

- `microsub_channels` - User channels
- `microsub_feeds` - Feed subscriptions with polling metadata
- `microsub_items` - Timeline items (posts)
- `microsub_notifications` - Notifications channel items
- `microsub_muted` - Muted URLs
- `microsub_blocked` - Blocked authors

## Troubleshooting

### Feeds not updating

- Check the feed's `nextFetchAt` time in the admin UI
- Use "Force Refresh" button to poll immediately
- Try "Rediscover" to find the correct feed URL

### "Unable to detect feed type" error

- The URL may not be a valid feed
- Try using the search feature to discover feeds from the homepage
- Check if the feed requires authentication

### Items disappearing after marking read

This is normal behavior - only the last 30 read items per channel are kept to prevent database bloat. Unread items are never deleted.

### Duplicate items

Deduplication is based on the feed's GUID/URL. If a feed doesn't provide stable GUIDs, duplicates may appear.

## Contributing

Issues and pull requests welcome at [github.com/rmdes/indiekit-endpoint-microsub](https://github.com/rmdes/indiekit-endpoint-microsub)

## License

MIT

## Credits

Built by [Ricardo Mendes](https://rmendes.net) for the IndieWeb community.
