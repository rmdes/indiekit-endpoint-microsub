/**
 * Shared HTML sanitization configuration
 * Used by both RSS/Atom normalizer and ActivityPub outbox fetcher
 * @module utils/sanitize
 */

/**
 * Allowed HTML tags and attributes for sanitize-html
 */
export const SANITIZE_OPTIONS = {
  allowedTags: [
    "a",
    "abbr",
    "b",
    "blockquote",
    "br",
    "code",
    "em",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strike",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
    "video",
    "audio",
    "source",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    video: ["src", "poster", "controls", "width", "height"],
    audio: ["src", "controls"],
    source: ["src", "type"],
    "*": ["class"],
  },
  allowedSchemes: ["http", "https", "mailto"],
};
