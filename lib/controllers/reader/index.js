/**
 * Reader controller - barrel re-export
 * @module controllers/reader
 */

export {
  index,
  channels,
  newChannel,
  createChannelAction,
  channel,
  channelHtml,
  settings,
  updateSettings,
  deleteChannelAction,
} from "./channel.js";

export {
  feeds,
  addFeed,
  removeFeed,
  feedDetails,
  editFeedForm,
  updateFeedUrl,
  rediscoverFeed,
  refreshFeed,
} from "./feed.js";

export {
  timeline,
  timelineHtml,
  markAllRead,
  markViewRead,
  item,
} from "./timeline.js";

export { compose, submitCompose } from "./compose.js";

export { searchPage, searchFeeds, subscribe } from "./search.js";

export {
  actorProfile,
  followActorAction,
  unfollowActorAction,
} from "./actor.js";

export { deck, deckSettings, saveDeckSettings } from "./deck.js";

import {
  index,
  channels,
  newChannel,
  createChannelAction,
  channel,
  channelHtml,
  settings,
  updateSettings,
  deleteChannelAction,
} from "./channel.js";

import {
  feeds,
  addFeed,
  removeFeed,
  feedDetails,
  editFeedForm,
  updateFeedUrl,
  rediscoverFeed,
  refreshFeed,
} from "./feed.js";

import {
  timeline,
  timelineHtml,
  markAllRead,
  markViewRead,
  item,
} from "./timeline.js";

import { compose, submitCompose } from "./compose.js";

import { searchPage, searchFeeds, subscribe } from "./search.js";

import {
  actorProfile,
  followActorAction,
  unfollowActorAction,
} from "./actor.js";

import { deck, deckSettings, saveDeckSettings } from "./deck.js";

export const readerController = {
  index,
  channels,
  newChannel,
  createChannel: createChannelAction,
  channel,
  channelHtml,
  settings,
  updateSettings,
  markAllRead,
  markViewRead,
  deleteChannel: deleteChannelAction,
  feeds,
  addFeed,
  removeFeed,
  feedDetails,
  editFeedForm,
  updateFeedUrl,
  rediscoverFeed,
  refreshFeed,
  item,
  compose,
  submitCompose,
  searchPage,
  searchFeeds,
  subscribe,
  actorProfile,
  followActorAction,
  unfollowActorAction,
  timeline,
  timelineHtml,
  deck,
  deckSettings,
  saveDeckSettings,
};
