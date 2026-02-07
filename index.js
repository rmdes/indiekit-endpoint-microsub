import path from "node:path";

import express from "express";

import { microsubController } from "./lib/controllers/microsub.js";
import { opmlController } from "./lib/controllers/opml.js";
import { readerController } from "./lib/controllers/reader.js";
import { handleMediaProxy } from "./lib/media/proxy.js";
import { startScheduler, stopScheduler } from "./lib/polling/scheduler.js";
import { cleanupAllReadItems, createIndexes } from "./lib/storage/items.js";
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

    // WebSub callback endpoint
    router.get("/websub/:id", websubHandler.verify);
    router.post("/websub/:id", websubHandler.receive);

    // Webmention receiving endpoint
    router.post("/webmention", webmentionReceiver.receive);

    // Media proxy endpoint
    router.get("/media/:hash", handleMediaProxy);

    // Reader UI routes (mounted as sub-router for correct baseUrl)
    readerRouter.get("/", readerController.index);
    readerRouter.get("/channels", readerController.channels);
    readerRouter.get("/channels/new", readerController.newChannel);
    readerRouter.post("/channels/new", readerController.createChannel);
    readerRouter.get("/channels/:uid", readerController.channel);
    readerRouter.get("/channels/:uid/settings", readerController.settings);
    readerRouter.post(
      "/channels/:uid/settings",
      readerController.updateSettings,
    );
    readerRouter.post("/channels/:uid/delete", readerController.deleteChannel);
    readerRouter.get("/channels/:uid/feeds", readerController.feeds);
    readerRouter.post("/channels/:uid/feeds", readerController.addFeed);
    readerRouter.post(
      "/channels/:uid/feeds/remove",
      readerController.removeFeed,
    );
    readerRouter.get(
      "/channels/:uid/feeds/:feedId",
      readerController.feedDetails,
    );
    readerRouter.get(
      "/channels/:uid/feeds/:feedId/edit",
      readerController.editFeedForm,
    );
    readerRouter.post(
      "/channels/:uid/feeds/:feedId/edit",
      readerController.updateFeedUrl,
    );
    readerRouter.post(
      "/channels/:uid/feeds/:feedId/rediscover",
      readerController.rediscoverFeed,
    );
    readerRouter.post(
      "/channels/:uid/feeds/:feedId/refresh",
      readerController.refreshFeed,
    );
    readerRouter.get("/item/:id", readerController.item);
    readerRouter.get("/compose", readerController.compose);
    readerRouter.post("/compose", readerController.submitCompose);
    readerRouter.get("/search", readerController.searchPage);
    readerRouter.post("/search", readerController.searchFeeds);
    readerRouter.post("/subscribe", readerController.subscribe);
    readerRouter.post("/api/mark-read", readerController.markAllRead);
    readerRouter.get("/opml", opmlController.exportOpml);
    router.use("/reader", readerRouter);

    return router;
  }

  /**
   * Public routes (no authentication required)
   * @returns {import("express").Router} Express router
   */
  get routesPublic() {
    const publicRouter = express.Router();

    // WebSub verification must be public for hubs to verify
    publicRouter.get("/websub/:id", websubHandler.verify);
    publicRouter.post("/websub/:id", websubHandler.receive);

    // Webmention endpoint must be public
    publicRouter.post("/webmention", webmentionReceiver.receive);

    // Media proxy must be public for images to load
    publicRouter.get("/media/:hash", handleMediaProxy);

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
      console.info("[Microsub] Database available, starting scheduler");
      startScheduler(indiekit);

      // Create indexes for optimal performance (runs in background)
      createIndexes(indiekit).catch((error) => {
        console.warn("[Microsub] Index creation failed:", error.message);
      });

      // Cleanup old read items on startup
      cleanupAllReadItems(indiekit).catch((error) => {
        console.warn("[Microsub] Startup cleanup failed:", error.message);
      });
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
    stopScheduler();
  }
}
