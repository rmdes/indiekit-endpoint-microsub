/**
 * Search indexer for MongoDB text search
 * @module search/indexer
 */

/**
 * Create text indexes for microsub items
 * @param {object} application - Indiekit application
 * @returns {Promise<void>}
 */
export async function createSearchIndexes(application) {
  const itemsCollection = application.collections.get("microsub_items");

  // Create compound text index for full-text search
  await itemsCollection.createIndex(
    {
      name: "text",
      "content.text": "text",
      "content.html": "text",
      summary: "text",
      "author.name": "text",
    },
    {
      name: "text_search",
      weights: {
        name: 10,
        "content.text": 5,
        summary: 3,
        "author.name": 2,
      },
      default_language: "english",
      background: true,
    },
  );

  // Create index for channel + published for efficient timeline queries
  await itemsCollection.createIndex(
    { channelId: 1, published: -1 },
    { name: "channel_timeline" },
  );

  // Create index for deduplication
  await itemsCollection.createIndex(
    { channelId: 1, uid: 1 },
    { name: "channel_uid", unique: true },
  );

  // Create index for feed-based queries
  await itemsCollection.createIndex({ feedId: 1 }, { name: "feed_items" });
}

/**
 * Rebuild search indexes (drops and recreates)
 * @param {object} application - Indiekit application
 * @returns {Promise<void>}
 */
export async function rebuildSearchIndexes(application) {
  const itemsCollection = application.collections.get("microsub_items");

  // Drop existing text index
  try {
    await itemsCollection.dropIndex("text_search");
  } catch {
    // Index may not exist
  }

  // Recreate indexes
  await createSearchIndexes(application);
}

/**
 * Get search index stats
 * @param {object} application - Indiekit application
 * @returns {Promise<object>} Index statistics
 */
export async function getSearchIndexStats(application) {
  const itemsCollection = application.collections.get("microsub_items");

  const indexes = await itemsCollection.indexes();
  const stats = await itemsCollection.stats();

  return {
    indexes: indexes.map((index) => ({
      name: index.name,
      key: index.key,
    })),
    totalDocuments: stats.count,
    size: stats.size,
  };
}
