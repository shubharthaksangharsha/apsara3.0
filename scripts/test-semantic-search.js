#!/usr/bin/env node

/**
 * Semantic Search Test Script
 * 
 * Tests the embedding and semantic search functionality:
 * 1. Connects to MongoDB
 * 2. Generates embeddings for a user's conversations
 * 3. Performs a semantic search
 * 
 * Usage:
 *   node scripts/test-semantic-search.js [--force-regen] [--query "your search query"]
 * 
 * Options:
 *   --force-regen    Force regeneration of all embeddings
 *   --query "..."    Custom search query (default: "Methamphetamine")
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

// Parse command line arguments
const args = process.argv.slice(2);
const forceRegen = args.includes('--force-regen');
const queryIndex = args.indexOf('--query');
const customQuery = queryIndex !== -1 ? args[queryIndex + 1] : null;

// Configuration
const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TEST_USER_EMAIL = 'pranchal018@gmail.com';
const TEST_SEARCH_QUERY = customQuery || 'Methamphetamine'; // Change this to test different queries
const EXPECTED_DIMENSIONS = 3072; // gemini-embedding-exp-03-07 outputs 3072 dimensions

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║           Semantic Search Test Script                                         ║
╠══════════════════════════════════════════════════════════════════════════════╣
`);

if (forceRegen) {
  console.log('🔄 Force regeneration mode: ALL embeddings will be regenerated\n');
}

// Validate environment
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in .env');
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY not found in .env');
  process.exit(1);
}

console.log('✅ Environment variables loaded');
console.log(`📧 Test user: ${TEST_USER_EMAIL}`);
console.log(`🔍 Test query: "${TEST_SEARCH_QUERY}"`);

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const EMBEDDING_MODEL = 'gemini-embedding-exp-03-07';

// MongoDB Schemas (simplified for testing)
const conversationSchema = new mongoose.Schema({
  conversationId: String,
  userId: String,
  title: String,
  embedding: [Number],
  embeddingUpdatedAt: Date,
  createdAt: Date,
  updatedAt: Date
}, { strict: false });

const messageSchema = new mongoose.Schema({
  messageId: String,
  conversationId: String,
  content: mongoose.Schema.Types.Mixed,
  role: String,
  createdAt: Date
}, { strict: false });

const userSchema = new mongoose.Schema({
  email: String,
}, { strict: false });

const Conversation = mongoose.model('Conversation', conversationSchema);
const Message = mongoose.model('Message', messageSchema);
const User = mongoose.model('User', userSchema);

/**
 * Generate embedding for text
 */
async function generateEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
  try {
    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: { taskType }
    });
    
    if (response.embeddings && response.embeddings.length > 0) {
      return response.embeddings[0].values;
    }
    throw new Error('No embeddings returned');
  } catch (error) {
    console.error(`❌ Embedding error: ${error.message}`);
    throw error;
  }
}

/**
 * Create searchable content from conversation
 */
function createSearchableContent(conversation, messages) {
  const parts = [];
  
  if (conversation.title && conversation.title !== 'New Conversation') {
    parts.push(conversation.title);
  }

  messages.slice(-10).forEach(msg => {
    if (msg.content?.text) {
      parts.push(msg.content.text);
    } else if (typeof msg.content === 'string') {
      parts.push(msg.content);
    }
  });

  return parts.join(' ').trim().substring(0, 5000);
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) {
    console.log(`   ⚠️ Vector length mismatch: query=${a?.length}, stored=${b?.length}`);
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Run manual similarity search
 */
async function runManualSearch(userId, queryEmbedding, searchQuery) {
  const conversationsWithEmbeddings = await Conversation.find({
    userId,
    embedding: { $exists: true, $ne: [] }
  });

  console.log(`   Found ${conversationsWithEmbeddings.length} conversations with embeddings`);

  if (conversationsWithEmbeddings.length === 0) {
    console.log('   No conversations with embeddings found');
    return;
  }

  // Check embedding dimensions
  const validConversations = conversationsWithEmbeddings.filter(
    c => c.embedding && c.embedding.length === queryEmbedding.length
  );
  
  const invalidCount = conversationsWithEmbeddings.length - validConversations.length;
  
  if (invalidCount > 0) {
    console.log(`   ⚠️ ${invalidCount} conversations have mismatched embedding dimensions (will be skipped)`);
  }
  
  console.log(`   Using ${validConversations.length} conversations for search`);

  if (validConversations.length === 0) {
    console.log('\n   ❌ NO VALID EMBEDDINGS!');
    console.log('   All stored embeddings have different dimensions than the query.');
    console.log('   Run this script with --force-regen to regenerate all embeddings.');
    return;
  }

  const results = validConversations.map(conv => ({
    title: conv.title,
    conversationId: conv.conversationId,
    embeddingUpdatedAt: conv.embeddingUpdatedAt,
    embeddingDimensions: conv.embedding?.length,
    score: cosineSimilarity(queryEmbedding, conv.embedding)
  })).sort((a, b) => b.score - a.score).slice(0, 10);

  console.log('\n   ✅ Manual Similarity Results (Top 10):');
  results.forEach((result, i) => {
    const date = result.embeddingUpdatedAt ? new Date(result.embeddingUpdatedAt).toLocaleDateString() : 'N/A';
    const relevant = result.score > 0.5 ? '🎯' : '';
    console.log(`      ${i + 1}. ${relevant}"${result.title}" (similarity: ${result.score.toFixed(4)}) [dims: ${result.embeddingDimensions}, embedded: ${date}]`);
  });
  
  // Check if any conversation contains the search query directly
  console.log(`\n   🔍 Checking which conversations contain "${searchQuery}" in their messages...`);
  for (const conv of conversationsWithEmbeddings) {
    const messages = await Message.find({ conversationId: conv.conversationId });
    
    const containsQuery = messages.some(msg => {
      const text = (msg.content?.text || msg.content || '').toLowerCase();
      return text.includes(searchQuery.toLowerCase());
    });
    
    if (containsQuery) {
      const result = results.find(r => r.conversationId === conv.conversationId);
      const score = result ? result.score.toFixed(4) : 'N/A';
      console.log(`      ✓ "${conv.title}" contains "${searchQuery}" - Similarity score: ${score}`);
      
      // Show the matching messages
      const matchingMsgs = messages.filter(msg => {
        const text = (msg.content?.text || msg.content || '').toLowerCase();
        return text.includes(searchQuery.toLowerCase());
      });
      
      console.log(`        Found in ${matchingMsgs.length} message(s):`);
      matchingMsgs.slice(0, 2).forEach(msg => {
        const text = msg.content?.text || msg.content || '';
        const index = text.toLowerCase().indexOf(searchQuery.toLowerCase());
        const snippet = text.substring(Math.max(0, index - 50), Math.min(text.length, index + searchQuery.length + 50));
        console.log(`        "...${snippet.replace(/\n/g, ' ')}..."`);
      });
    }
  }
}

/**
 * Main test function
 */
async function runTest() {
  try {
    // Connect to MongoDB
    console.log('\n📡 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB Atlas\n');

    // Find user
    console.log(`🔍 Finding user: ${TEST_USER_EMAIL}`);
    const user = await User.findOne({ email: TEST_USER_EMAIL });
    
    if (!user) {
      console.error(`❌ User not found: ${TEST_USER_EMAIL}`);
      process.exit(1);
    }
    
    console.log(`✅ Found user: ${user._id}`);
    const userId = user._id.toString();

    // Get user's conversations - load ALL
    console.log('\n📂 Fetching ALL conversations...');
    const conversations = await Conversation.find({ userId });
    console.log(`✅ Found ${conversations.length} total conversations`);

    if (conversations.length === 0) {
      console.log('⚠️ No conversations found for this user');
      process.exit(0);
    }

    // Show existing conversations
    console.log('\n📋 Conversations:');
    conversations.forEach((conv, i) => {
      const hasEmbedding = conv.embedding && conv.embedding.length > 0;
      console.log(`   ${i + 1}. "${conv.title}" ${hasEmbedding ? '✅' : '❌'} embedding`);
    });

    // Generate embeddings for conversations without them (or force regenerate)
    console.log('\n🔄 Processing embeddings...');
    let generatedCount = 0;
    let skippedCount = 0;
    let wrongDimCount = 0;
    
    for (const conv of conversations) {
      const hasValidEmbedding = conv.embedding && conv.embedding.length === EXPECTED_DIMENSIONS;
      
      if (hasValidEmbedding && !forceRegen) {
        skippedCount++;
        continue; // Skip if already has valid embedding
      }
      
      if (conv.embedding && conv.embedding.length !== EXPECTED_DIMENSIONS) {
        wrongDimCount++;
        console.log(`   ⚠️ "${conv.title}" has wrong embedding dimensions (${conv.embedding.length}), will regenerate`);
      }

      try {
        // Get messages for this conversation
        const messages = await Message.find({ conversationId: conv.conversationId })
          .sort({ createdAt: -1 })
          .limit(10);

        const searchableContent = createSearchableContent(conv, messages);
        
        if (!searchableContent || searchableContent.length < 5) {
          console.log(`   ⏭️ Skipping "${conv.title}" (no content)`);
          continue;
        }

        // For "addiction" conversation, show the content being embedded
        if (conv.title.toLowerCase().includes('addiction')) {
          console.log(`\n   📋 Content being embedded for "addiction" conversation:`);
          console.log(`   ────────────────────────────────────────────────────────`);
          console.log(`   ${searchableContent.substring(0, 500)}...`);
          console.log(`   ────────────────────────────────────────────────────────\n`);
        }

        console.log(`   📝 Generating embedding for "${conv.title}"...`);
        const embedding = await generateEmbedding(searchableContent);
        
        // Update conversation with embedding
        await Conversation.updateOne(
          { _id: conv._id },
          { 
            embedding: embedding,
            embeddingUpdatedAt: new Date()
          }
        );
        
        generatedCount++;
        console.log(`   ✅ Saved (${embedding.length} dimensions)`);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
      }
    }

    console.log(`\n✅ Embedding summary:`);
    console.log(`   - Generated/regenerated: ${generatedCount}`);
    console.log(`   - Skipped (already valid): ${skippedCount}`);
    console.log(`   - Had wrong dimensions: ${wrongDimCount}`);

    // Test semantic search
    console.log(`\n🔍 Testing semantic search: "${TEST_SEARCH_QUERY}"...`);
    
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(TEST_SEARCH_QUERY, 'RETRIEVAL_QUERY');
    console.log(`✅ Query embedding generated (${queryEmbedding.length} dimensions)`);

    // Check if we can use vector search
    console.log('\n🔎 Attempting vector search...');
    
    try {
      // First, try WITHOUT filter to see if the index works at all
      console.log('\n   📋 Test 1: Vector Search WITHOUT userId filter...');
      const vectorResultsNoFilter = await Conversation.aggregate([
        {
          $vectorSearch: {
            index: 'conversation_embedding_index',
            path: 'embedding',
            queryVector: queryEmbedding,
            numCandidates: 100,
            limit: 10
          }
        },
        {
          $project: {
            conversationId: 1,
            title: 1,
            userId: 1,
            score: { $meta: 'vectorSearchScore' }
          }
        }
      ]);

      if (vectorResultsNoFilter.length === 0) {
        console.log('   ❌ No results found even without filter!');
        console.log('   This means the index has a configuration problem.');
        console.log('   Check that index dimensions match: 3072');
      } else {
        console.log(`   ✅ Found ${vectorResultsNoFilter.length} results WITHOUT filter:`);
        vectorResultsNoFilter.forEach((result, i) => {
          const isTargetUser = result.userId === userId;
          console.log(`      ${i + 1}. "${result.title}" (score: ${result.score?.toFixed(4)}) ${isTargetUser ? '👤 YOUR USER' : ''}`);
        });
      }
      
      // Now try WITH filter
      console.log('\n   📋 Test 2: Vector Search WITH userId filter...');
      const vectorResults = await Conversation.aggregate([
        {
          $vectorSearch: {
            index: 'conversation_embedding_index',
            path: 'embedding',
            queryVector: queryEmbedding,
            numCandidates: 100,
            limit: 10,
            filter: { userId: userId }
          }
        },
        {
          $project: {
            conversationId: 1,
            title: 1,
            userId: 1,
            score: { $meta: 'vectorSearchScore' }
          }
        }
      ]);

      if (vectorResults.length === 0) {
        console.log('   ❌ No results found WITH filter!');
        console.log('   The filter is causing the issue.');
        console.log('   ');
        console.log('   🔧 TO FIX: You need to recreate the index with userId as a filter field.');
        console.log('   Go to MongoDB Atlas → Search & Vector Search → Edit Index');
        console.log('   Use this JSON definition:');
        console.log('   {');
        console.log('     "mappings": {');
        console.log('       "dynamic": true,');
        console.log('       "fields": {');
        console.log('         "embedding": {');
        console.log('           "type": "knnVector",');
        console.log('           "dimensions": 3072,');
        console.log('           "similarity": "cosine"');
        console.log('         },');
        console.log('         "userId": {');
        console.log('           "type": "token"');
        console.log('         }');
        console.log('       }');
        console.log('     }');
        console.log('   }');
      } else {
        console.log(`   ✅ Found ${vectorResults.length} results WITH filter:`);
        vectorResults.forEach((result, i) => {
          console.log(`      ${i + 1}. "${result.title}" (score: ${result.score?.toFixed(4)})`);
        });
      }
      
      // Always run manual search for comparison
      console.log('\n🔄 Running manual similarity search for comparison...');
      await runManualSearch(userId, queryEmbedding, TEST_SEARCH_QUERY);
      
    } catch (error) {
      if (error.message?.includes('$vectorSearch') || error.code === 40324) {
        console.log('\n⚠️ Vector Search index not configured!');
        console.log('   You need to create a Vector Search index in MongoDB Atlas.');
        console.log('   Run: node scripts/setup-vector-index.js for instructions.\n');
        
        // Fallback: Manual cosine similarity (for testing)
        console.log('🔄 Falling back to manual similarity search...');
        
        const conversationsWithEmbeddings = await Conversation.find({
          userId,
          embedding: { $exists: true, $ne: [] }
        });

        if (conversationsWithEmbeddings.length === 0) {
          console.log('   No conversations with embeddings found');
        } else {
          // Calculate cosine similarity manually
          const cosineSimilarity = (a, b) => {
            if (!a || !b || a.length !== b.length) return 0;
            let dotProduct = 0;
            let normA = 0;
            let normB = 0;
            for (let i = 0; i < a.length; i++) {
              dotProduct += a[i] * b[i];
              normA += a[i] * a[i];
              normB += b[i] * b[i];
            }
            return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
          };

          const results = conversationsWithEmbeddings.map(conv => ({
            title: conv.title,
            conversationId: conv.conversationId,
            score: cosineSimilarity(queryEmbedding, conv.embedding)
          })).sort((a, b) => b.score - a.score).slice(0, 5);

          console.log('\n✅ Manual Similarity Results:');
          results.forEach((result, i) => {
            console.log(`   ${i + 1}. "${result.title}" (similarity: ${result.score.toFixed(4)})`);
          });
        }
      } else {
        throw error;
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════════════════════════');
    console.log('✅ Test completed successfully!');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Disconnected from MongoDB');
  }
}

// Run the test
runTest();
