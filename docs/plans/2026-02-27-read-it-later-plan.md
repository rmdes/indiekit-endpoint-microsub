# Read It Later — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone Indiekit plugin (`@rmdes/indiekit-endpoint-readlater`) that provides a private "read it later" bookmark list, with save buttons integrated into microsub reader, activitypub reader, and Eleventy frontend pages.

**Architecture:** A minimal standalone plugin owns a single MongoDB collection (`readlater_items`) and exposes save/delete API endpoints plus an admin page. Other plugins and the Eleventy theme add per-item save icons that POST to the API. Detection is soft — buttons only render if the plugin is installed.

**Tech Stack:** Express routes, MongoDB, Nunjucks templates (`@indiekit/frontend` layout), vanilla JS (microsub) and Alpine.js (activitypub/theme) for save button interactions.

**Design Doc:** `docs/plans/2026-02-27-read-it-later-design.md` (in indiekit-endpoint-microsub repo)

---

## Phase 1: Standalone Plugin

> All Phase 1 files are created in a **new repo**: `/home/rick/code/indiekit-dev/indiekit-endpoint-readlater/`

### Task 1: Initialize the plugin repo and package.json

**Files:**
- Create: `package.json`
- Create: `.gitignore`

**Step 1: Create repo directory**

```bash
mkdir -p /home/rick/code/indiekit-dev/indiekit-endpoint-readlater
cd /home/rick/code/indiekit-dev/indiekit-endpoint-readlater
git init
```

**Step 2: Create package.json**

```json
{
  "name": "@rmdes/indiekit-endpoint-readlater",
  "version": "1.0.0",
  "description": "Read It Later endpoint for Indiekit. Save URLs from any context for later consumption.",
  "keywords": [
    "indiekit",
    "indiekit-plugin",
    "indieweb",
    "read-later",
    "bookmarks",
    "reading-list"
  ],
  "homepage": "https://github.com/rmdes/indiekit-endpoint-readlater",
  "bugs": {
    "url": "https://github.com/rmdes/indiekit-endpoint-readlater/issues"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/rmdes/indiekit-endpoint-readlater.git"
  },
  "author": {
    "name": "Ricardo Mendes",
    "url": "https://rmendes.net"
  },
  "license": "MIT",
  "engines": {
    "node": ">=20"
  },
  "type": "module",
  "main": "index.js",
  "exports": {
    ".": "./index.js"
  },
  "files": [
    "lib",
    "locales",
    "views",
    "assets",
    "index.js"
  ],
  "dependencies": {
    "@indiekit/error": "^1.0.0-beta.25",
    "@indiekit/frontend": "^1.0.0-beta.25",
    "express": "^5.0.0"
  },
  "peerDependencies": {
    "@indiekit/indiekit": ">=1.0.0-beta.25"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

**Step 3: Create .gitignore**

```
node_modules/
```

**Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: initialize plugin repo"
```

---

### Task 2: Storage layer — items.js

**Files:**
- Create: `lib/storage/items.js`

**Step 1: Create the storage module**

This module handles all MongoDB operations for the `readlater_items` collection.

```javascript
/**
 * Read It Later item storage operations
 * @module storage/items
 */

import { ObjectId } from "mongodb";

/**
 * Get the readlater_items collection
 * @param {object} application - Indiekit application
 * @returns {object} MongoDB collection
 */
function getCollection(application) {
  return application.collections.get("readlater_items");
}

/**
 * Save a URL for later reading
 * @param {object} application - Indiekit application
 * @param {object} data - Item data
 * @param {string} data.url - URL to save
 * @param {string} data.title - Display title
 * @param {string} data.source - Source context (microsub, activitypub, blogroll, etc.)
 * @returns {Promise<{item: object, created: boolean}>} Saved item and whether it was newly created
 */
export async function saveItem(application, { url, title, source }) {
  const collection = getCollection(application);

  // Check for existing item with same URL
  const existing = await collection.findOne({ url });
  if (existing) {
    return { item: existing, created: false };
  }

  const item = {
    url,
    title: title || url,
    source: source || "manual",
    savedAt: new Date().toISOString(),
  };

  const result = await collection.insertOne(item);
  item._id = result.insertedId;
  return { item, created: true };
}

/**
 * Delete a saved item
 * @param {object} application - Indiekit application
 * @param {object} params - Delete params
 * @param {string} [params.id] - Item _id
 * @param {string} [params.url] - Item URL
 * @returns {Promise<boolean>} Whether an item was deleted
 */
export async function deleteItem(application, { id, url }) {
  const collection = getCollection(application);

  let filter;
  if (id) {
    filter = { _id: new ObjectId(id) };
  } else if (url) {
    filter = { url };
  } else {
    return false;
  }

  const result = await collection.deleteOne(filter);
  return result.deletedCount > 0;
}

/**
 * Get saved items with optional filtering and sorting
 * @param {object} application - Indiekit application
 * @param {object} [options] - Query options
 * @param {string} [options.sort] - Sort direction: "asc" or "desc" (default: "desc")
 * @param {string} [options.source] - Filter by source
 * @param {string} [options.q] - Search query (matches title and url)
 * @returns {Promise<object[]>} Array of saved items
 */
export async function getItems(application, options = {}) {
  const collection = getCollection(application);

  const filter = {};

  if (options.source) {
    filter.source = options.source;
  }

  if (options.q) {
    const escaped = options.q.replaceAll(
      /[$()*+.?[\\\]^{|}]/g,
      "\\$&",
    );
    const regex = new RegExp(escaped, "i");
    filter.$or = [{ title: regex }, { url: regex }];
  }

  const sortDirection = options.sort === "asc" ? 1 : -1;

  return collection
    .find(filter)
    .sort({ savedAt: sortDirection })
    .toArray();
}

/**
 * Check if a URL is already saved
 * @param {object} application - Indiekit application
 * @param {string} url - URL to check
 * @returns {Promise<boolean>} Whether the URL is saved
 */
export async function isSaved(application, url) {
  const collection = getCollection(application);
  const item = await collection.findOne({ url });
  return !!item;
}

/**
 * Get distinct source values that have saved items
 * @param {object} application - Indiekit application
 * @returns {Promise<string[]>} Array of source strings
 */
export async function getSources(application) {
  const collection = getCollection(application);
  return collection.distinct("source");
}

/**
 * Create MongoDB indexes for the collection
 * @param {object} application - Indiekit application
 */
export async function createIndexes(application) {
  const collection = getCollection(application);
  await collection.createIndex({ url: 1 }, { unique: true });
  await collection.createIndex({ savedAt: -1 });
  await collection.createIndex({ source: 1 });
}
```

**Step 2: Commit**

```bash
git add lib/storage/items.js
git commit -m "feat: add storage layer for read-it-later items"
```

---

### Task 3: Controller — readlater.js

**Files:**
- Create: `lib/controllers/readlater.js`

**Step 1: Create the controller**

Handles the admin page (GET) and API endpoints (POST save/delete).

```javascript
/**
 * Read It Later controller
 * @module controllers/readlater
 */

import {
  saveItem,
  deleteItem,
  getItems,
  getSources,
} from "../storage/items.js";

/**
 * Admin page — list saved items with filters
 */
async function list(request, response) {
  const { application } = request.app.locals;
  const baseUrl = request.baseUrl;

  const sort = request.query.sort || "desc";
  const source = request.query.source || "";
  const q = request.query.q || "";

  const items = await getItems(application, { sort, source, q });
  const sources = await getSources(application);

  response.render("readlater", {
    title: "Read It Later",
    items,
    sources,
    sort,
    source,
    q,
    baseUrl,
    breadcrumbs: [{ text: "Read It Later" }],
  });
}

/**
 * Save a URL — POST /readlater/save
 * Accepts JSON or form-encoded: { url, title, source }
 */
async function save(request, response) {
  const { application } = request.app.locals;

  const url = request.body.url;
  if (!url) {
    return response.status(400).json({ error: "URL is required" });
  }

  const title = request.body.title || url;
  const source = request.body.source || "manual";

  const { item, created } = await saveItem(application, {
    url,
    title,
    source,
  });

  if (created) {
    return response.json({ success: true, item });
  }

  return response.json({ success: true, item, alreadySaved: true });
}

/**
 * Delete a saved item — POST /readlater/delete
 * Accepts JSON or form-encoded: { id } or { url }
 */
async function remove(request, response) {
  const { application } = request.app.locals;

  const id = request.body.id;
  const url = request.body.url;

  if (!id && !url) {
    return response.status(400).json({ error: "id or url is required" });
  }

  const deleted = await deleteItem(application, { id, url });

  if (deleted) {
    return response.json({ success: true });
  }

  return response.status(404).json({ error: "Not found" });
}

export const readlaterController = { list, save, remove };
```

**Step 2: Commit**

```bash
git add lib/controllers/readlater.js
git commit -m "feat: add controller for read-it-later admin and API"
```

---

### Task 4: Admin page template — readlater.njk

**Files:**
- Create: `views/readlater.njk`
- Create: `assets/styles.css`

**Step 1: Create the admin page template**

Uses `@indiekit/frontend` layout (same as all Indiekit plugins).

```nunjucks
{% extends "document.njk" %}

{% block content %}
<link rel="stylesheet" href="/assets/@rmdes-indiekit-endpoint-readlater/styles.css">

<div class="readlater">
  <header class="readlater__header">
    <h1>{{ title }}</h1>
  </header>

  {# Filters toolbar #}
  <form action="{{ baseUrl }}" method="GET" class="readlater__filters">
    <div class="readlater__filter-group">
      <label for="sort" class="readlater__filter-label">Sort</label>
      <select name="sort" id="sort" class="readlater__select">
        <option value="desc" {% if sort == "desc" %}selected{% endif %}>Newest first</option>
        <option value="asc" {% if sort == "asc" %}selected{% endif %}>Oldest first</option>
      </select>
    </div>

    <div class="readlater__filter-group">
      <label for="source" class="readlater__filter-label">Source</label>
      <select name="source" id="source" class="readlater__select">
        <option value="">All sources</option>
        {% for s in sources %}
        <option value="{{ s }}" {% if source == s %}selected{% endif %}>{{ s }}</option>
        {% endfor %}
      </select>
    </div>

    <div class="readlater__filter-group readlater__filter-group--search">
      <label for="q" class="readlater__filter-label">Search</label>
      <input type="search" name="q" id="q" value="{{ q }}" placeholder="Search title or URL..." class="readlater__input">
    </div>

    <button type="submit" class="button button--primary button--small">Filter</button>
    {% if source or q %}
    <a href="{{ baseUrl }}" class="button button--secondary button--small">Clear</a>
    {% endif %}
  </form>

  {# Items list #}
  {% if items.length > 0 %}
  <div class="readlater__list" id="readlater-list">
    {% for item in items %}
    <div class="readlater__item" data-item-id="{{ item._id }}">
      <div class="readlater__item-content">
        <a href="{{ item.url }}" class="readlater__item-title" target="_blank" rel="noopener">
          {{ item.title }}
        </a>
        <div class="readlater__item-meta">
          <span class="readlater__source-badge readlater__source-badge--{{ item.source }}">
            {{ item.source }}
          </span>
          {% if item.savedAt %}
          <time datetime="{{ item.savedAt }}" class="readlater__item-date">
            {{ item.savedAt | date("PPp", { locale: locale, timeZone: application.timeZone }) }}
          </time>
          {% endif %}
        </div>
      </div>
      <button type="button"
              class="readlater__delete"
              data-item-id="{{ item._id }}"
              title="Remove">
        {{ icon("delete") }}
      </button>
    </div>
    {% endfor %}
  </div>
  {% else %}
  <div class="readlater__empty">
    <p>{% if q or source %}No items match your filters.{% else %}No saved items yet. Save items from the microsub reader, activitypub reader, or frontend pages.{% endif %}</p>
  </div>
  {% endif %}
</div>

<script type="module">
  const list = document.getElementById('readlater-list');
  if (list) {
    list.addEventListener('click', async (e) => {
      const button = e.target.closest('.readlater__delete');
      if (!button) return;

      e.preventDefault();
      button.disabled = true;

      const itemId = button.dataset.itemId;
      if (!itemId) return;

      try {
        const response = await fetch('{{ baseUrl }}/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: itemId }),
          credentials: 'same-origin'
        });

        if (response.ok) {
          const row = button.closest('.readlater__item');
          if (row) {
            row.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            row.style.opacity = '0';
            row.style.transform = 'translateX(-20px)';
            setTimeout(() => row.remove(), 300);
          }
        } else {
          button.disabled = false;
        }
      } catch {
        button.disabled = false;
      }
    });
  }
</script>
{% endblock %}
```

**Step 2: Create the stylesheet**

```css
/* Read It Later admin styles */

.readlater__header {
  margin-bottom: var(--space-m);
}

.readlater__filters {
  align-items: flex-end;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-s);
  margin-bottom: var(--space-l);
}

.readlater__filter-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.readlater__filter-group--search {
  flex: 1;
  min-width: 200px;
}

.readlater__filter-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary, #666);
}

.readlater__select,
.readlater__input {
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  font-size: 0.875rem;
  padding: 0.375rem 0.5rem;
}

.readlater__list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--color-border, #ddd);
  border: 1px solid var(--color-border, #ddd);
  border-radius: 4px;
  overflow: hidden;
}

.readlater__item {
  align-items: center;
  background: var(--color-background, #fff);
  display: flex;
  gap: var(--space-s);
  padding: var(--space-s) var(--space-m);
}

.readlater__item-content {
  flex: 1;
  min-width: 0;
}

.readlater__item-title {
  color: var(--color-text, #333);
  display: block;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.readlater__item-title:hover {
  color: var(--color-accent, #00f);
}

.readlater__item-meta {
  align-items: center;
  display: flex;
  gap: var(--space-s);
  margin-top: var(--space-2xs);
}

.readlater__source-badge {
  border-radius: 3px;
  color: #fff;
  display: inline-block;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1;
  padding: 2px 6px;
  text-transform: uppercase;
  background: #888;
}

.readlater__source-badge--microsub { background: #4a9eff; }
.readlater__source-badge--activitypub { background: #6364ff; }
.readlater__source-badge--blogroll { background: #10b981; }
.readlater__source-badge--podroll { background: #f59e0b; }
.readlater__source-badge--listening { background: #ec4899; }
.readlater__source-badge--news { background: #ef4444; }

.readlater__item-date {
  color: var(--color-text-secondary, #666);
  font-size: 0.75rem;
}

.readlater__delete {
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--color-text-secondary, #666);
  cursor: pointer;
  flex-shrink: 0;
  padding: 0.25rem;
}

.readlater__delete:hover {
  border-color: var(--color-border, #ddd);
  color: #dc2626;
}

.readlater__empty {
  color: var(--color-text-secondary, #666);
  padding: var(--space-l);
  text-align: center;
}
```

**Step 3: Commit**

```bash
git add views/readlater.njk assets/styles.css
git commit -m "feat: add admin page template and styles"
```

---

### Task 5: Plugin entry point — index.js

**Files:**
- Create: `index.js`

**Step 1: Create the plugin entry point**

Follows the same pattern as blogroll and microsub plugins.

```javascript
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { readlaterController } from "./lib/controllers/readlater.js";
import { createIndexes } from "./lib/storage/items.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defaults = {
  mountPath: "/readlater",
};

const router = express.Router();

export default class ReadLaterEndpoint {
  name = "Read It Later endpoint";

  constructor(options = {}) {
    this.options = { ...defaults, ...options };
    this.mountPath = this.options.mountPath;
  }

  get localesDirectory() {
    return path.join(__dirname, "locales");
  }

  get navigationItems() {
    return {
      href: this.options.mountPath,
      text: "readlater.title",
      requiresDatabase: true,
    };
  }

  get shortcutItems() {
    return {
      url: this.options.mountPath,
      name: "readlater.title",
      iconName: "bookmark",
      requiresDatabase: true,
    };
  }

  get routes() {
    router.get("/", readlaterController.list);
    router.post("/save", readlaterController.save);
    router.post("/delete", readlaterController.remove);
    return router;
  }

  init(Indiekit) {
    console.info("[ReadLater] Initializing read-it-later plugin");

    Indiekit.addCollection("readlater_items");
    Indiekit.addEndpoint(this);

    // Store mount path in application config for other plugins to detect
    Indiekit.config.application.readlaterEndpoint = this.mountPath;

    if (Indiekit.database) {
      createIndexes(Indiekit).catch((error) => {
        console.warn("[ReadLater] Index creation failed:", error.message);
      });
    }
  }
}
```

**Step 2: Commit**

```bash
git add index.js
git commit -m "feat: add plugin entry point with routes and init"
```

---

### Task 6: Locale file — en.json

**Files:**
- Create: `locales/en.json`

**Step 1: Create English locale**

```json
{
  "readlater": {
    "title": "Read It Later",
    "empty": "No saved items yet.",
    "emptyFiltered": "No items match your filters.",
    "save": "Save for later",
    "saved": "Saved",
    "remove": "Remove",
    "filters": {
      "sort": "Sort",
      "source": "Source",
      "search": "Search",
      "allSources": "All sources",
      "newestFirst": "Newest first",
      "oldestFirst": "Oldest first",
      "apply": "Filter",
      "clear": "Clear"
    }
  }
}
```

**Step 2: Commit**

```bash
git add locales/en.json
git commit -m "feat: add English locale strings"
```

---

### Task 7: CLAUDE.md and README

**Files:**
- Create: `CLAUDE.md`

**Step 1: Create CLAUDE.md**

```markdown
# CLAUDE.md - indiekit-endpoint-readlater

## Package Overview

`@rmdes/indiekit-endpoint-readlater` is a "Read It Later" plugin for Indiekit. It provides a private bookmark list where you can save URLs from any context (microsub reader, activitypub reader, blogroll, podroll, listening, news) for later consumption.

**Package Name:** `@rmdes/indiekit-endpoint-readlater`
**Type:** ESM module
**Entry Point:** `index.js`

## MongoDB Collection

### `readlater_items`

```javascript
{
  _id: ObjectId,
  url: "https://example.com/article",     // Unique — prevents duplicates
  title: "Article Title",                  // Display title
  source: "microsub" | "activitypub" | "blogroll" | "podroll" | "listening" | "news" | "manual",
  savedAt: "2026-02-27T12:00:00.000Z",    // ISO 8601 string
}
```

**Indexes:**
- `{ url: 1 }` unique — deduplication
- `{ savedAt: -1 }` — sort by date
- `{ source: 1 }` — filter by source

## API Endpoints

All routes require authentication.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/readlater` | — | Admin page (HTML) |
| POST | `/readlater/save` | `{url, title, source}` | `{success, item, alreadySaved?}` |
| POST | `/readlater/delete` | `{id}` or `{url}` | `{success}` or `{error}` |

## Integration with Other Plugins

Other plugins detect this plugin by checking `application.readlaterEndpoint`. If set, they render a save button. If not, no button appears.

### How to add a save button in another plugin's template:

```nunjucks
{% if application.readlaterEndpoint %}
<button class="save-for-later" data-url="{{ itemUrl }}" data-title="{{ itemTitle }}">
  Save
</button>
{% endif %}
```

```javascript
button.addEventListener('click', async () => {
  const response = await fetch('/readlater/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, title, source: 'pluginName' }),
    credentials: 'same-origin'
  });
});
```

## Key Files

- `index.js` — Plugin entry point, routes, init
- `lib/storage/items.js` — MongoDB CRUD operations
- `lib/controllers/readlater.js` — Admin page and API handlers
- `views/readlater.njk` — Admin page template
- `assets/styles.css` — Admin page styles
- `locales/en.json` — English locale strings
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md"
```

---

### Task 8: Install dependencies and verify plugin loads

**Step 1: Install dependencies**

```bash
cd /home/rick/code/indiekit-dev/indiekit-endpoint-readlater
npm install
```

**Step 2: Verify the module exports correctly**

```bash
node -e "import('./index.js').then(m => { const e = new m.default(); console.log(e.name, e.mountPath); })"
```

Expected: `Read It Later endpoint /readlater`

**Step 3: Commit lock file**

```bash
git add package-lock.json
git commit -m "chore: add package-lock.json"
```

---

## Phase 2: Microsub Reader Integration

> These changes are in `/home/rick/code/indiekit-dev/indiekit-endpoint-microsub/`

### Task 9: Add save button to microsub item-card

**Files:**
- Modify: `views/partials/item-card.njk:170-211` (action bar)

**Step 1: Add save-for-later button to item-card action bar**

In `views/partials/item-card.njk`, inside the `<div class="item-actions">` block (after the mark-read button, around line 210), add:

```nunjucks
    {% if application.readlaterEndpoint %}
    <button type="button"
            class="item-actions__button item-actions__save-later"
            data-action="save-later"
            data-url="{{ item.url }}"
            data-title="{{ item.name or item.content.text | truncate(80) or item.url }}"
            title="Save for later">
      {{ icon("bookmark") }}
      <span class="visually-hidden">Save for later</span>
    </button>
    {% endif %}
```

**Step 2: Add save-later JS handler to timeline.njk and channel.njk**

In both `views/timeline.njk` and `views/channel.njk`, inside the existing `<script>` block, add a click handler for `.item-actions__save-later` buttons. Pattern is the same as mark-read:

```javascript
// Handle save-for-later buttons
timeline.addEventListener('click', async (e) => {
  const button = e.target.closest('.item-actions__save-later');
  if (!button) return;

  e.preventDefault();
  e.stopPropagation();

  const url = button.dataset.url;
  const title = button.dataset.title;
  if (!url) return;

  button.disabled = true;

  try {
    const response = await fetch('/readlater/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title, source: 'microsub' }),
      credentials: 'same-origin'
    });

    if (response.ok) {
      button.classList.add('item-actions__save-later--saved');
      button.title = 'Saved';
    } else {
      button.disabled = false;
    }
  } catch {
    button.disabled = false;
  }
});
```

**Step 3: Add saved state CSS to styles.css**

In `assets/styles.css`, add:

```css
.item-actions__save-later--saved {
  color: var(--color-accent, #4a9eff);
  opacity: 0.6;
}
```

**Step 4: Bump version to 1.0.41**

Update `package.json` version.

**Step 5: Commit**

```bash
cd /home/rick/code/indiekit-dev/indiekit-endpoint-microsub
git add views/partials/item-card.njk views/timeline.njk views/channel.njk assets/styles.css package.json
git commit -m "feat: add save-for-later button to microsub reader"
```

---

## Phase 3: ActivityPub Reader Integration

> These changes are in `/home/rick/code/indiekit-dev/indiekit-endpoint-activitypub/`

### Task 10: Add save button to activitypub item card

**Files:**
- Modify: `views/partials/ap-item-card.njk:213-215` (action bar, before the error div)
- Modify: `assets/reader.css` (add saved state style)

**Step 1: Add save button to ap-item-card.njk**

The activitypub reader uses Alpine.js for interactions. Add a save button before the `<div x-show="error"` line (line 216).

In the `x-data` object (around line 151), add a `saved` state:

```javascript
saved: false,
async saveLater() {
  if (this.saved) return;
  const el = this.$root;
  const itemUrl = el.dataset.itemUrl;
  try {
    const res = await fetch('/readlater/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: itemUrl,
        title: document.querySelector('[data-item-url="' + itemUrl + '"]')?.closest('article')?.querySelector('.ap-card__text p')?.textContent?.substring(0, 80) || itemUrl,
        source: 'activitypub'
      }),
      credentials: 'same-origin'
    });
    if (res.ok) this.saved = true;
  } catch (e) {
    this.error = e.message;
  }
}
```

Add the button HTML after the "View original" link:

```nunjucks
    {% if application.readlaterEndpoint %}
    <button class="ap-card__action ap-card__action--save"
      :class="{ 'ap-card__action--active': saved }"
      :disabled="saved"
      @click="saveLater()"
      :title="saved ? 'Saved' : 'Save for later'">
      <span x-text="saved ? '🔖' : '📑'"></span>
      <span x-text="saved ? '{{ __('activitypub.reader.actions.saved') || 'Saved' }}' : '{{ __('activitypub.reader.actions.saveLater') || 'Save' }}'"></span>
    </button>
    {% endif %}
```

**Step 2: Add CSS for saved state**

In `assets/reader.css`, add:

```css
.ap-card__action--save.ap-card__action--active {
  background: #4a9eff22;
  border-color: #4a9eff;
  color: #4a9eff;
}
```

**Step 3: Bump version**

Update `package.json` version.

**Step 4: Commit**

```bash
cd /home/rick/code/indiekit-dev/indiekit-endpoint-activitypub
git add views/partials/ap-item-card.njk assets/reader.css package.json
git commit -m "feat: add save-for-later button to activitypub reader"
```

---

## Phase 4: Eleventy Frontend Theme Integration

> These changes are in `/home/rick/code/indiekit-dev/indiekit-eleventy-theme/`
> The theme uses Alpine.js (`x-for` loops) and `admin.js` sets `data-indiekit-auth="true"` on `<body>` when logged in.

### Task 11: Add shared save-later JS module to theme

**Files:**
- Create: `js/save-later.js`

**Step 1: Create the shared JS module**

This module provides a reusable function for all frontend pages. It is gated by the `data-indiekit-auth` attribute.

```javascript
/**
 * Save for Later — shared frontend module
 * Handles save button clicks on blogroll, podroll, listening, and news pages.
 * Only active when user is logged in (body[data-indiekit-auth="true"]).
 */

(function () {
  function isLoggedIn() {
    return document.body.getAttribute('data-indiekit-auth') === 'true';
  }

  async function saveForLater(button) {
    const url = button.dataset.saveUrl;
    const title = button.dataset.saveTitle || url;
    const source = button.dataset.saveSource || 'manual';
    if (!url) return;

    button.disabled = true;

    try {
      const response = await fetch('/readlater/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, title, source }),
        credentials: 'same-origin'
      });

      if (response.ok) {
        button.classList.add('save-later--saved');
        button.title = 'Saved';
        button.setAttribute('aria-label', 'Saved');
      } else {
        button.disabled = false;
      }
    } catch {
      button.disabled = false;
    }
  }

  // Delegate clicks on save-later buttons
  document.addEventListener('click', function (e) {
    if (!isLoggedIn()) return;
    var button = e.target.closest('.save-later-btn');
    if (button) {
      e.preventDefault();
      saveForLater(button);
    }
  });

  // Show save buttons when auth confirmed
  window.addEventListener('indiekit:auth', function (e) {
    if (e.detail.loggedIn) {
      document.querySelectorAll('.save-later-btn').forEach(function (btn) {
        btn.style.display = '';
      });
    }
  });
})();
```

**Step 2: Add CSS for save-later buttons**

In `css/tailwind.css`, add in the admin UI section:

```css
/* Save for Later buttons — hidden until auth confirmed */
.save-later-btn {
  display: none;
  cursor: pointer;
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 0.75rem;
  color: #666;
  transition: all 0.2s ease;
}

body[data-indiekit-auth="true"] .save-later-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.save-later-btn:hover {
  border-color: #ddd;
  color: #4a9eff;
}

.save-later--saved {
  color: #4a9eff;
  opacity: 0.6;
  pointer-events: none;
}
```

**Step 3: Include the script in base layout**

In `_includes/layouts/base.njk`, add the script tag after the existing `admin.js` script:

```html
<script src="/js/save-later.js" defer></script>
```

**Step 4: Commit**

```bash
cd /home/rick/code/indiekit-dev/indiekit-eleventy-theme
git add js/save-later.js css/tailwind.css _includes/layouts/base.njk
git commit -m "feat: add shared save-for-later module for frontend pages"
```

---

### Task 12: Add save buttons to blogroll page

**Files:**
- Modify: `blogroll.njk` — category items loop (around line 111-181)

**Step 1: Add save button to each blog post item**

Inside the `<template x-for="item in categoryItems">` loop, after the item link, add:

```html
<button class="save-later-btn"
        :data-save-url="item.link || item.url"
        :data-save-title="item.title"
        data-save-source="blogroll"
        title="Save for later"
        aria-label="Save for later">
  📑 Save
</button>
```

**Step 2: Commit**

```bash
git add blogroll.njk
git commit -m "feat: add save-for-later buttons to blogroll page"
```

---

### Task 13: Add save buttons to podroll page

**Files:**
- Modify: `podroll.njk` — episodes loop (around line 68-149)

**Step 1: Add save button to each episode**

Inside the `<template x-for="episode in filteredEpisodes">` loop, after the episode actions area, add:

```html
<button class="save-later-btn"
        :data-save-url="episode.link || episode.enclosure"
        :data-save-title="episode.title"
        data-save-source="podroll"
        title="Save for later"
        aria-label="Save for later">
  📑 Save
</button>
```

**Step 2: Commit**

```bash
git add podroll.njk
git commit -m "feat: add save-for-later buttons to podroll page"
```

---

### Task 14: Add save buttons to listening page

**Files:**
- Modify: `listening.njk` — recent listens and favorites loops

**Step 1: Add save buttons to Funkwhale listens (around line 272-300)**

Inside the `{% for listening in funkwhaleActivity.listenings %}` loop:

```html
<button class="save-later-btn"
        data-save-url="{{ listening.url or listening.trackUrl }}"
        data-save-title="{{ listening.title }} — {{ listening.artist }}"
        data-save-source="listening"
        title="Save for later"
        aria-label="Save for later">
  📑
</button>
```

**Step 2: Add to Last.fm scrobbles (around line 307-338)**

Same pattern with scrobble data.

**Step 3: Add to loved/favorite tracks sections**

Same pattern for the loved tracks and favorites grid items.

**Step 4: Commit**

```bash
git add listening.njk
git commit -m "feat: add save-for-later buttons to listening page"
```

---

### Task 15: Add save buttons to news page

**Files:**
- Modify: `news.njk` — all three view modes (list, card, expanded)

**Step 1: Add save button to list view (around line 127-166)**

Inside the `<template x-for="item in filteredItems">` loop for list view:

```html
<button class="save-later-btn"
        :data-save-url="item.link"
        :data-save-title="item.title"
        data-save-source="news"
        title="Save for later"
        aria-label="Save for later">
  📑 Save
</button>
```

**Step 2: Add to card view (around line 171-198)**

Same pattern.

**Step 3: Add to expanded view (around line 203-260)**

Same pattern.

**Step 4: Commit**

```bash
git add news.njk
git commit -m "feat: add save-for-later buttons to news page"
```

---

## Phase 5: Deployment

### Task 16: Publish and deploy

**Step 1: Create GitHub repo**

Create `rmdes/indiekit-endpoint-readlater` on GitHub.

```bash
cd /home/rick/code/indiekit-dev/indiekit-endpoint-readlater
git remote add origin git@github.com:rmdes/indiekit-endpoint-readlater.git
git push -u origin main
```

**Step 2: npm publish**

User runs `npm publish` with OTP (Claude cannot do this).

**Step 3: Update Dockerfile**

In `/home/rick/code/indiekit-dev/indiekit-cloudron/Dockerfile`, add to the npm install line:

```
@rmdes/indiekit-endpoint-readlater@1.0.0 \
```

**Step 4: Update indiekit.config.js**

Add to the plugins array in `indiekit.config.js`:

```javascript
import ReadLaterEndpoint from "@rmdes/indiekit-endpoint-readlater";

// In plugins array:
new ReadLaterEndpoint(),
```

**Step 5: Update Eleventy theme submodule** (if Phase 4 is ready)

```bash
cd /home/rick/code/indiekit-dev/indiekit-cloudron
git submodule update --remote eleventy-site
```

**Step 6: Build and deploy**

```bash
cloudron build --no-cache && cloudron update --app rmendes.net --no-backup
```

---

## Summary

| Phase | Tasks | Repo |
|-------|-------|------|
| Phase 1: Plugin | Tasks 1-8 | `indiekit-endpoint-readlater` (new) |
| Phase 2: Microsub | Task 9 | `indiekit-endpoint-microsub` |
| Phase 3: ActivityPub | Task 10 | `indiekit-endpoint-activitypub` |
| Phase 4: Theme | Tasks 11-15 | `indiekit-eleventy-theme` |
| Phase 5: Deploy | Task 16 | `indiekit-cloudron` |

**Total:** 16 tasks across 4 repos + deployment.
