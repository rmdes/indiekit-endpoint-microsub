/**
 * Shared HTML utilities
 * @module utils/html
 */

/**
 * Extract image URLs from HTML content (fallback for items without explicit photos)
 * @param {string} html - HTML content
 * @returns {string[]} Array of image URLs
 */
export function extractImagesFromHtml(html) {
  if (!html) {
    return [];
  }
  const urls = [];
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (src && !urls.includes(src)) {
      urls.push(src);
    }
  }
  return urls;
}
