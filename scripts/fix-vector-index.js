#!/usr/bin/env node

/**
 * Fix Vector Search Index
 * 
 * This script:
 * 1. Drops the existing vector search index
 * 2. Creates a new one with correct 3072 dimensions
 * 3. Waits for it to build
 * 4. Tests it
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const INDEX_NAME = 'conversation_embedding_index';
const COLLECTION_NAME = 'conversations';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🔧 Vector Search Index Fix Tool\n');
  
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI not set');
    process.exit(1);
  }
  
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  console.log('✅ Connected to MongoDB\n');
  
  // Step 1: Check current state
  console.log('📊 Step 1: Checking current state...');
  const embeddingCount = await db.collection(COLLECTION_NAME).countDocuments({
    embedding: { $exists: true, $type: 'array' }
  });
  console.log(`   Found ${embeddingCount} documents with embeddings`);
  
  // Check a sample embedding dimension
  const sample = await db.collection(COLLECTION_NAME).findOne({ embedding: { $exists: true } });
  if (sample && sample.embedding) {
    console.log(`   Sample embedding dimension: ${sample.embedding.length}`);
  }
  
  // Step 2: Try to drop existing index
  console.log('\n🗑️  Step 2: Dropping existing index...');
  try {
    await db.collection(COLLECTION_NAME).dropSearchIndex(INDEX_NAME);
    console.log('   ✅ Index dropped successfully');
    console.log('   Waiting 10 seconds for deletion to propagate...');
    await sleep(10000);
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('does not exist')) {
      console.log('   ℹ️  Index does not exist, skipping drop');
    } else {
      console.log('   ⚠️  Drop failed:', err.message);
    }
  }
  
  // Step 3: Create new index
  console.log('\n🔨 Step 3: Creating new index with 3072 dimensions...');
  const indexDefinition = {
    name: INDEX_NAME,
    definition: {
      fields: [
        {
          type: 'vector',
          path: 'embedding',
          numDimensions: 3072,
          similarity: 'cosine'
        },
        {
          type: 'filter',
          path: 'userId'
        }
      ]
    }
  };
  
  console.log('   Index definition:', JSON.stringify(indexDefinition.definition, null, 2));
  
  try {
    const result = await db.collection(COLLECTION_NAME).createSearchIndex(indexDefinition);
    console.log('   ✅ Index creation initiated:', result);
  } catch (err) {
    console.log('   ❌ Index creation failed:', err.message);
    if (err.codeName) console.log('   Error code:', err.codeName);
    
    // If index already exists, we might need to update it
    if (err.message.includes('already exists')) {
      console.log('\n   Trying to update existing index...');
      try {
        await db.collection(COLLECTION_NAME).updateSearchIndex(INDEX_NAME, indexDefinition.definition);
        console.log('   ✅ Index update initiated');
      } catch (updateErr) {
        console.log('   ❌ Update also failed:', updateErr.message);
        await mongoose.disconnect();
        process.exit(1);
      }
    } else {
      await mongoose.disconnect();
      process.exit(1);
    }
  }
  
  // Step 4: Wait for index to be ready
  console.log('\n⏳ Step 4: Waiting for index to build (this may take a few minutes)...');
  let attempts = 0;
  const maxAttempts = 30; // 5 minutes max
  let indexReady = false;
  
  while (attempts < maxAttempts && !indexReady) {
    attempts++;
    await sleep(10000); // Wait 10 seconds between checks
    
    try {
      // Try a test query
      const testResults = await db.collection(COLLECTION_NAME).aggregate([
        {
          $vectorSearch: {
            index: INDEX_NAME,
            path: 'embedding',
            queryVector: sample.embedding,
            numCandidates: 10,
            limit: 1
          }
        }
      ]).toArray();
      
      if (testResults.length > 0) {
        indexReady = true;
        console.log(`   ✅ Index is ready after ${attempts * 10} seconds!`);
      } else {
        console.log(`   ⏳ Attempt ${attempts}/${maxAttempts}: Index building... (${testResults.length} results)`);
      }
    } catch (err) {
      console.log(`   ⏳ Attempt ${attempts}/${maxAttempts}: ${err.message}`);
    }
  }
  
  if (!indexReady) {
    console.log('\n⚠️  Index may still be building. Check Atlas dashboard.');
  }
  
  // Step 5: Final test
  console.log('\n🧪 Step 5: Final test...');
  try {
    const results = await db.collection(COLLECTION_NAME).aggregate([
      {
        $vectorSearch: {
          index: INDEX_NAME,
          path: 'embedding',
          queryVector: sample.embedding,
          numCandidates: 100,
          limit: 5
        }
      },
      {
        $project: {
          title: 1,
          score: { $meta: 'vectorSearchScore' }
        }
      }
    ]).toArray();
    
    console.log(`   Found ${results.length} results:`);
    results.forEach((r, i) => {
      console.log(`   ${i + 1}. "${r.title}" (score: ${r.score?.toFixed(4)})`);
    });
    
    if (results.length > 0) {
      console.log('\n✅ SUCCESS! Vector search is working!');
    } else {
      console.log('\n⚠️  No results yet. Index may still be building.');
    }
  } catch (err) {
    console.log('   ❌ Test failed:', err.message);
  }
  
  await mongoose.disconnect();
  console.log('\n📡 Disconnected from MongoDB');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
