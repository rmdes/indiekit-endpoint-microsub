import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import rateLimit from "express-rate-limit";
import { waitForReady } from "@rmdes/indiekit-startup-gate";

import { microsubController } from "./lib/controllers/microsub.js";
import { opmlController } from "./lib/controllers/opml.js";
import { readerController } from "./lib/controllers/reader/index.js";
import { asyncHandler } from "./lib/utils/async-handler.js";
import { handleMediaProxy } from "./lib/media/proxy.js";
import { csrfToken, csrfValidate } from "./lib/utils/csrf.js";
import { startScheduler, stopScheduler } from "./lib/polling/scheduler.js";
import { ensureActivityPubChannel } from "./lib/storage/channels.js";
import { createIndexes } from "./lib/storage/items.js";
import {
  cleanupAllReadItems,
  cleanupStaleItems,
} from "./lib/storage/items-retention.js";
import { webmentionReceiver } from "./lib/webmention/receiver.js";
import { websubHandler } from "./lib/websub/handler.js";

const defaults = {
  mountPath: "/microsub",
};
const router = express.Router();
const readerRouter = express.Router();

export default class MicrosubEndpoint {
  name = "Microsub endpoint";

  /**
   * @param {object} options - Plugin options
   * @param {string} [options.mountPath] - Path to mount Microsub endpoint
   */
  constructor(options = {}) {
    this.options = { ...defaults, ...options };
    this.mountPath = this.options.mountPath;
  }

  /**
   * Locales directory path
   * @returns {string} Path to locales directory
   */
  get localesDirectory() {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), "locales");
  }

  /**
   * Navigation items for Indiekit admin
   * @returns {object} Navigation item configuration
   */
  get navigationItems() {
    return {
      href: path.join(this.options.mountPath, "reader"),
      text: "microsub.reader.title",
      requiresDatabase: true,
    };
  }

  /**
   * Shortcut items for quick actions
   * @returns {object} Shortcut item configuration
   */
  get shortcutItems() {
    return {
      url: path.join(this.options.mountPath, "reader", "channels"),
      name: "microsub.channels.title",
      iconName: "feed",
      requiresDatabase: true,
    };
  }

  /**
   * Microsub API and reader UI routes (authenticated)
   * @returns {import("express").Router} Express router
   */
  get routes() {
    // Main Microsub endpoint - dispatches based on action parameter
    router.get("/", microsubController.get);
    router.post("/", microsubController.post);

    // WebSub, webmention, and media proxy are registered in routesPublic only
    // (they must be accessible without authentication)

    // Reader UI routes (mounted as sub-router for correct baseUrl)
    // CSRF protection: generate token on all requests, validate on POST
    readerRouter.use(csrfToken);
    readerRouter.use(csrfValidate);

    readerRouter.get("/", asyncHandler(readerController.index));
    readerRouter.get("/channels", asyncHandler(readerController.channels));
    readerRouter.get("/channels/new", asyncHandler(readerController.newChannel));
    readerRouter.post("/channels/new", asyncHandler(readerController.createChannel));
    readerRouter.get("/channels/:uid/html", asyncHandler(readerController.channelHtml));
    readerRouter.get("/channels/:uid", asyncHandler(readerController.channel));
    readerRouter.get("/channels/:uid/settings", asyncHandler(readerController.settings));
    readerRouter.post(
      "/channels/:uid/settings",
      asyncHandler(readerController.updateSettings),
    );
    readerRouter.post("/channels/:uid/delete", asyncHandler(readerController.deleteChannel));
    readerRouter.get("/channels/:uid/feeds", asyncHandler(readerController.feeds));
    readerRouter.post("/channels/:uid/feeds", asyncHandler(readerController.addFeed));
    readerRouter.post(
      "/channels/:uid/feeds/remove",
      asyncHandler(readerController.removeFeed),
    );
    readerRouter.get(
      "/channels/:uid/feeds/:feedId",
      asyncHandler(readerController.feedDetails),
    );
    readerRouter.get(
      "/channels/:uid/feeds/:feedId/edit",
      asyncHandler(readerController.editFeedForm),
    );
    readerRouter.post(
      "/channels/:uid/feeds/:feedId/edit",
      asyncHandler(readerController.updateFeedUrl),
    );
    readerRouter.post(
      "/channels/:uid/feeds/:feedId/rediscover",
      asyncHandler(readerController.rediscoverFeed),
    );
    readerRouter.post(
      "/channels/:uid/feeds/:feedId/refresh",
      asyncHandler(readerController.refreshFeed),
    );
    readerRouter.get("/item/:id", asyncHandler(readerController.item));
    readerRouter.get("/compose", asyncHandler(readerController.compose));
    readerRouter.post("/compose", asyncHandler(readerController.submitCompose));
    readerRouter.get("/search", asyncHandler(readerController.searchPage));
    readerRouter.post("/search", asyncHandler(readerController.searchFeeds));
    readerRouter.post("/subscribe", asyncHandler(readerController.subscribe));
    readerRouter.get("/actor", asyncHandler(readerController.actorProfile));
    readerRouter.post("/actor/follow", asyncHandler(readerController.followActorAction));
    readerRouter.post("/actor/unfollow", asyncHandler(readerController.unfollowActorAction));
    readerRouter.post("/api/mark-read", asyncHandler(readerController.markAllRead));
    readerRouter.post("/api/mark-view-read", asyncHandler(readerController.markViewRead));
    readerRouter.get("/opml", opmlController.exportOpml);
    readerRouter.get("/timeline/html", asyncHandler(readerController.timelineHtml));
    readerRouter.get("/timeline", asyncHandler(readerController.timeline));
    readerRouter.get("/deck", asyncHandler(readerController.deck));
    readerRouter.get("/deck/settings", asyncHandler(readerController.deckSettings));
    readerRouter.post("/deck/settings", asyncHandler(readerController.saveDeckSettings));
    router.use("/reader", readerRouter);

    return router;
  }

  /**
   * Public routes (no authentication required)
   * @returns {import("express").Router} Express router
   */
  get routesPublic() {
    const publicRouter = express.Router();

    // Rate limiters for public endpoints
    const mediaLimiter = rateLimit({ windowMs: 60_000, max: 120, message: "Too many requests" });
    const websubLimiter = rateLimit({ windowMs: 60_000, max: 30, message: "Too many requests" });
    const webmentionLimiter = rateLimit({ windowMs: 60_000, max: 10, message: "Too many requests" });

    // WebSub verification must be public for hubs to verify
    publicRouter.get("/websub/:id", websubLimiter, websubHandler.verify);
    publicRouter.post("/websub/:id", websubLimiter, websubHandler.receive);

    // Webmention endpoint must be public
    publicRouter.post("/webmention", webmentionLimiter, webmentionReceiver.receive);

    // Media proxy must be public for images to load
    publicRouter.get("/media/:hash", mediaLimiter, handleMediaProxy);

    return publicRouter;
  }

  /**
   * Initialize plugin
   * @param {object} indiekit - Indiekit instance
   */
  init(indiekit) {
    console.info("[Microsub] Initializing endpoint-microsub plugin");

    // Register MongoDB collections
    indiekit.addCollection("microsub_channels");
    indiekit.addCollection("microsub_feeds");
    indiekit.addCollection("microsub_items");
    indiekit.addCollection("microsub_notifications");
    indiekit.addCollection("microsub_muted");
    indiekit.addCollection("microsub_blocked");
    indiekit.addCollection("microsub_deck_config");

    console.info("[Microsub] Registered MongoDB collections");

    // Register endpoint
    indiekit.addEndpoint(this);

    // Set microsub endpoint URL in config
    if (!indiekit.config.application.microsubEndpoint) {
      indiekit.config.application.microsubEndpoint = this.mountPath;
    }

    // Start feed polling scheduler when server starts
    // This will be called after the server is ready
    if (indiekit.database) {
      // Indexes are cheap and idempotent — create immediately
      createIndexes(indiekit).catch((error) => {
        console.warn("[Microsub] Index creation failed:", error.message);
      });

      // Defer heavy tasks until host is ready
      this._stopGate = waitForReady(
        () => {
          console.info("[Microsub] Starting scheduler and maintenance tasks");
          startScheduler(indiekit);

          // Ensure system channels exist
          ensureActivityPubChannel(indiekit).catch((error) => {
            console.warn(
              "[Microsub] ActivityPub channel creation failed:",
              error.message,
            );
          });

          // Cleanup old read items on startup
          cleanupAllReadItems(indiekit).catch((error) => {
            console.warn("[Microsub] Startup cleanup failed:", error.message);
          });

          // Delete stale items (stripped skeletons + unread older than 30 days)
          cleanupStaleItems(indiekit).catch((error) => {
            console.warn("[Microsub] Stale cleanup failed:", error.message);
          });

          // Schedule daily stale cleanup (items accumulate between restarts)
          setInterval(() => {
            cleanupStaleItems(indiekit).catch((error) => {
              console.warn("[Microsub] Scheduled stale cleanup failed:", error.message);
            });
          }, 24 * 60 * 60 * 1000);
        },
        { label: "Microsub" },
      );
    } else {
      console.warn(
        "[Microsub] Database not available at init, scheduler not started",
      );
    }
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    this._stopGate?.();
    stopScheduler();
  }
}
