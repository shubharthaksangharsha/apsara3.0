#!/usr/bin/env node

/**
 * MongoDB Atlas Vector Search Index Setup Script
 * 
 * This script creates the required vector search index for semantic search.
 * Run this ONCE after deploying the backend to set up the index.
 * 
 * Prerequisites:
 * 1. MongoDB Atlas M10+ cluster (Vector Search requires dedicated cluster)
 * 2. Database connection configured in .env
 * 
 * Usage:
 *   node scripts/setup-vector-index.js
 * 
 * IMPORTANT: Vector Search indexes can only be created through:
 * - Atlas UI (recommended)
 * - Atlas Admin API
 * - Atlas CLI
 * 
 * This script provides the index definition you need to create manually.
 */

import dotenv from 'dotenv';

dotenv.config();

const INDEX_DEFINITION = {
  name: "conversation_embedding_index",
  // New Atlas Vector Search format (2024+)
  definition: {
    fields: [
      {
        type: "vector",
        path: "embedding",
        numDimensions: 3072, // gemini-embedding-exp-03-07 outputs 3072 dimensions
        similarity: "cosine"
      },
      {
        type: "filter",
        path: "userId"
      }
    ]
  }
};

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║           MongoDB Atlas Vector Search Index Setup                             ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  To enable semantic search, you need to create a Vector Search index         ║
║  in your MongoDB Atlas cluster.                                              ║
║                                                                              ║
║  STEPS:                                                                      ║
║  1. Go to your MongoDB Atlas cluster dashboard                               ║
║  2. Click on "Search" tab                                                    ║
║  3. Click "Create Search Index"                                              ║
║  4. Choose "JSON Editor" for custom index                                    ║
║  5. Select your database and the 'conversations' collection                  ║
║  6. Paste the following index definition:                                    ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

Index Name: conversation_embedding_index
Collection: conversations

JSON Definition:
`);

console.log(JSON.stringify(INDEX_DEFINITION.definition, null, 2));

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  ALTERNATIVE: Use Atlas CLI                                                  ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  atlas clusters search indexes create \\                                      ║
║    --clusterName <your-cluster-name> \\                                       ║
║    --db <your-database-name> \\                                               ║
║    --collection conversations \\                                              ║
║    --file vector-index.json                                                  ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════════════╗
║  HOW SEMANTIC SEARCH WORKS                                                   ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  1. When a conversation is created/updated, the backend generates an         ║
║     embedding vector using Gemini's embedding API                            ║
║                                                                              ║
║  2. The embedding captures the semantic meaning of the conversation          ║
║     title and recent messages                                                ║
║                                                                              ║
║  3. When you search, the query is converted to an embedding and              ║
║     MongoDB finds conversations with similar meanings                        ║
║                                                                              ║
║  4. Results are ranked by semantic similarity (cosine distance)              ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

For testing, you can generate embeddings for existing conversations using:
  POST /api/conversations/embeddings/batch
  Body: { "userId": "your-user-id" }
`);

// Export for programmatic use
export { INDEX_DEFINITION };
