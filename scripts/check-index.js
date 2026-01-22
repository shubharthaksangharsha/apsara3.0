#!/usr/bin/env node

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function checkAndTest() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  
  console.log("Checking index status...\n");
  
  const indexes = await db.collection("conversations").listSearchIndexes().toArray();
  const index = indexes.find(i => i.name === "conversation_embedding_index");
  
  if (!index) {
    console.log("❌ Index not found!");
    await mongoose.disconnect();
    return;
  }
  
  console.log("✅ Index found!");
  console.log("   Name:", index.name);
  console.log("   Status:", index.status);
  console.log("   Queryable:", index.queryable);
  console.log("   Definition:", JSON.stringify(index.latestDefinition, null, 2));
  
  if (index.status === "READY" || index.queryable) {
    console.log("\n🧪 Testing vector search...");
    
    // Get a sample embedding
    const sample = await db.collection("conversations").findOne({ 
      embedding: { $exists: true, $type: "array" } 
    });
    
    if (!sample) {
      console.log("No sample document found");
      await mongoose.disconnect();
      return;
    }
    
    console.log("Using embedding from:", sample.title, "dims:", sample.embedding.length);
    
    try {
      const results = await db.collection("conversations").aggregate([
        {
          $vectorSearch: {
            index: "conversation_embedding_index",
            path: "embedding",
            queryVector: sample.embedding,
            numCandidates: 100,
            limit: 5
          }
        },
        {
          $project: {
            title: 1,
            userId: 1,
            score: { $meta: "vectorSearchScore" }
          }
        }
      ]).toArray();
      
      console.log("\n✅ Vector Search Results:", results.length);
      results.forEach((r, i) => {
        console.log(`   ${i+1}. "${r.title}" (score: ${r.score?.toFixed(4) || "N/A"})`);
      });
      
      if (results.length > 0) {
        console.log("\n🎉 SUCCESS! Vector search is working!");
      }
    } catch (err) {
      console.log("\n❌ Search error:", err.message);
    }
  } else {
    console.log("\n⏳ Index still building... please wait a few minutes and try again.");
    console.log("   Status detail:", JSON.stringify(index.statusDetail));
  }
  
  await mongoose.disconnect();
}

checkAndTest().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
