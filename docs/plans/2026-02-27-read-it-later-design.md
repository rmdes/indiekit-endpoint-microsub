# Read It Later — Design Document

**Date:** 2026-02-27
**Status:** Approved

## Goal

A standalone Indiekit plugin (`@rmdes/indiekit-endpoint-readlater`) that provides a private "read it later" bookmark list. Save URLs from any context — backend readers (microsub, activitypub) and frontend pages (blogroll, podroll, listening, news) — into a unified collection for later consumption.

## Architecture

A minimal standalone plugin owns a single MongoDB collection and exposes a save/delete API. Other plugins and the Eleventy theme add per-item save icons that POST to this API. The plugin has its own admin page for managing saved items. No content is copied — only URLs with metadata.

## Data Model

**Collection:** `readlater_items`

```javascript
{
  _id: ObjectId,
  url: "https://example.com/article",     // Unique key — prevents duplicates
  title: "Article Title",                  // Display title
  source: "microsub" | "activitypub" | "blogroll" | "podroll" | "listening" | "news" | "manual",
  savedAt: "2026-02-27T12:00:00.000Z",    // ISO 8601 string
}
```

**Index:** `{ url: 1 }` unique.

## API Endpoints

All routes require authentication. No public routes.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/readlater` | Admin page — list saved items with filters |
| POST | `/readlater/save` | Save a URL — accepts `{url, title, source}`, returns JSON |
| POST | `/readlater/delete` | Delete a saved item — accepts `{url}` or `{id}`, returns JSON |

**Save response:** `{success: true, item: {...}}` or `{error: "Already saved"}`.

**Delete response:** `{success: true}` or `{error: "Not found"}`.

## Admin Page (`/readlater`)

List view showing all saved items with:

- **Sort toggle:** Newest first (default) / oldest first — `?sort=asc|desc`
- **Source filter:** Dropdown showing only sources with saved items — `?source=microsub`
- **Search box:** Text search across title and URL — `?q=search+term`
- **Per-item display:** Title (linked to original URL, new tab), source badge, saved date, delete button
- **Delete animation:** Fade-out on delete, same pattern as microsub mark-read

Filters work via query parameters (bookmarkable, no JS required for filtering).

**Navigation:** Sidebar entry under "Read & Engage".

## Integration Strategy

### Detection

Each consuming plugin checks at startup/render whether `@rmdes/indiekit-endpoint-readlater` is installed. If not installed, save buttons don't render. No hard dependency.

### Button Behavior

1. Click save icon -> POST to `/readlater/save` -> icon changes to filled/checkmark state
2. Already saved -> API returns "already saved" -> icon stays in saved state
3. No unsave from item cards — manage saved items from `/readlater` admin page

## Phase 1: Plugin + Backend Readers

**New plugin:** `@rmdes/indiekit-endpoint-readlater`
- MongoDB collection, indexes
- Save/delete API endpoints
- Admin page with filters

**Microsub reader** (`indiekit-endpoint-microsub`):
- Add save icon to `item-card.njk` action bar (alongside reply, like, repost, bookmark, mark-read)
- Button sends `{url: item.url, title: item.name, source: "microsub"}`

**ActivityPub reader** (`indiekit-endpoint-activitypub`):
- Add save icon to post action bar (alongside reply, boost, like, view original)
- Button sends `{url: originalPostUrl, title: contentSnippet, source: "activitypub"}`

## Phase 2: Frontend Theme Integration

**Repo:** `indiekit-eleventy-theme` (separate from plugin)

Add per-item save icons to frontend pages, only visible when logged in:

- `/blogroll/` — per blog post link
- `/podroll` — per episode link
- `/listening/` — per track/listen
- `/news` — per RSS item

Same API call (`POST /readlater/save`), same button behavior.

Auth gating uses the same mechanism as the existing "Create new post" FAB.

## Lifecycle

- Items persist until manually deleted
- No auto-expiry, no archiving
- No content storage — just URL bookmarks

## Tech Stack

- Express routes (Indiekit plugin API)
- MongoDB (single collection)
- Nunjucks templates (@indiekit/frontend layout)
- Vanilla JS for save button fetch calls
