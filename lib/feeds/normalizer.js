/**
 * Feed normalizer — shared helpers
 * @module feeds/normalizer
 */

import crypto from "node:crypto";

import sanitizeHtml from "sanitize-html";

import { SANITIZE_OPTIONS } from "../utils/sanitize.js";
import { extractImagesFromHtml } from "../utils/html.js";

// Re-export for use by format-specific normalizers
export { SANITIZE_OPTIONS, sanitizeHtml, extractImagesFromHtml };

/**
 * Generate unique ID for an item
 * @param {string} feedUrl - Feed URL
 * @param {string} itemId - Item identifier (URL or ID)
 * @returns {string} Unique ID hash
 */
export function generateItemUid(feedUrl, itemId) {
  const hash = crypto.createHash("sha256");
  hash.update(`${feedUrl}::${itemId}`);
  return hash.digest("hex").slice(0, 24);
}

/**
 * Parse a date string with fallback for non-standard formats
 * @param {string|Date} dateInput - Date string or Date object
 * @returns {Date|undefined} Parsed Date or undefined if invalid
 */
export function parseDate(dateInput) {
  if (!dateInput) {
    return;
  }

  // Already a valid Date
  if (dateInput instanceof Date && !Number.isNaN(dateInput.getTime())) {
    return dateInput;
  }

  const dateString = String(dateInput).trim();

  // Try standard parsing first
  let date = new Date(dateString);
  if (!Number.isNaN(date.getTime())) {
    return date;
  }

  // Handle "YYYY-MM-DD HH:MM" format (missing seconds and timezone)
  // e.g., "2026-01-28 08:40"
  const shortDateTime = dateString.match(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/,
  );
  if (shortDateTime) {
    date = new Date(`${shortDateTime[1]}T${shortDateTime[2]}:00Z`);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  // Handle "YYYY-MM-DD HH:MM:SS" without timezone
  const dateTimeNoTz = dateString.match(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/,
  );
  if (dateTimeNoTz) {
    date = new Date(`${dateTimeNoTz[1]}T${dateTimeNoTz[2]}Z`);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  // If all else fails, return undefined
  return;
}

/**
 * Safely convert date to ISO string
 * @param {string|Date} dateInput - Date input
 * @returns {string|undefined} ISO string or undefined
 */
export function toISOStringSafe(dateInput) {
  const date = parseDate(dateInput);
  return date ? date.toISOString() : undefined;
}

/**
 * Extract URL string from a photo value
 * @param {object|string} photo - Photo value (can be string URL or object with value/url)
 * @returns {string|undefined} Photo URL string
 */
export function extractPhotoUrl(photo) {
  if (!photo) {
    return;
  }
  if (typeof photo === "string") {
    return photo;
  }
  if (typeof photo === "object") {
    return photo.value || photo.url || photo.src;
  }
  return;
}

/**
 * Extract URL string from a value that may be string or object
 * @param {object|string} value - URL string or object with url/value property
 * @returns {string|undefined} URL string
 */
export function extractUrl(value) {
  if (!value) {
    return;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    return value.value || value.url || value.href;
  }
  return;
}

/**
 * Normalize an array of URLs that may contain strings or objects
 * @param {Array} urls - Array of URL strings or objects
 * @returns {Array<string>} Array of URL strings
 */
export function normalizeUrlArray(urls) {
  if (!urls || !Array.isArray(urls)) {
    return [];
  }
  return urls.map((u) => extractUrl(u)).filter(Boolean);
}

/**
 * Get first item from array or return the value itself
 * @param {Array|*} value - Value or array of values
 * @returns {*} First value or the value itself
 */
export function getFirst(value) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Get text content from content property
 * @param {Array} content - Content property array
 * @returns {string} Text content
 */
export function getContentText(content) {
  const first = getFirst(content);
  if (typeof first === "object") {
    return first.value || first.text || "";
  }
  return first || "";
}
