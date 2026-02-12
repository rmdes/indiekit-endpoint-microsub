/**
 * Block controller
 * @module controllers/block
 */

import { deleteItemsByAuthorUrl } from "../storage/items.js";
import { getUserId } from "../utils/auth.js";
import { validateUrl } from "../utils/validation.js";

/**
 * Get blocked collection
 * @param {object} application - Indiekit application
 * @returns {object} MongoDB collection
 */
function getCollection(application) {
  return application.collections.get("microsub_blocked");
}

/**
 * List blocked URLs
 * GET ?action=block
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function list(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);

  const collection = getCollection(application);
  const blocked = await collection.find({ userId }).toArray();
  const items = blocked.map((b) => ({ url: b.url }));

  response.json({ items });
}

/**
 * Block a URL
 * POST ?action=block
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function block(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { url } = request.body;

  validateUrl(url);

  const collection = getCollection(application);

  // Check if already blocked
  const existing = await collection.findOne({ userId, url });
  if (!existing) {
    await collection.insertOne({
      userId,
      url,
      createdAt: new Date().toISOString(),
    });
  }

  // Remove past items from blocked URL
  await deleteItemsByAuthorUrl(application, userId, url);

  response.json({ result: "ok" });
}

/**
 * Unblock a URL
 * POST ?action=unblock
 * @param {object} request - Express request
 * @param {object} response - Express response
 */
export async function unblock(request, response) {
  const { application } = request.app.locals;
  const userId = getUserId(request);
  const { url } = request.body;

  validateUrl(url);

  const collection = getCollection(application);
  await collection.deleteOne({ userId, url });

  response.json({ result: "ok" });
}

export const blockController = { list, block, unblock };
