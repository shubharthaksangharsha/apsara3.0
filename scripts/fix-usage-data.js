/**
 * Migration script to fix UserUsage data
 * 
 * Problem: MongoDB was treating dots in field names as nested paths,
 * so 'gemini-2.5-flash' was stored as { 'gemini-2': { '5-flash': {...} } }
 * 
 * Solution: This script resets the dailyUsage data to use the correct
 * field names with underscores: 'gemini-2_5-flash'
 * 
 * Run with: node scripts/fix-usage-data.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/apsara';

async function fixUsageData() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const usageCollection = db.collection('userusages');

    // Find all usage documents
    const usageDocs = await usageCollection.find({}).toArray();
    console.log(`📊 Found ${usageDocs.length} usage documents to fix`);

    for (const doc of usageDocs) {
      const userId = doc.userId;
      console.log(`\n🔧 Fixing usage for user: ${userId}`);
      console.log('   Current dailyUsage:', JSON.stringify(doc.dailyUsage, null, 2));

      // Get the current date
      const today = new Date().toISOString().split('T')[0];

      // Create the corrected dailyUsage structure
      const correctedDailyUsage = {
        date: today, // Reset to today
        'gemini-2_5-flash': {
          count: 0,
          limit: doc.subscriptionPlan === 'premium' ? 100 : 20
        },
        'gemini-2_5-pro': {
          count: 0,
          limit: doc.subscriptionPlan === 'premium' ? 50 : 5
        }
      };

      // Update the document with corrected structure
      await usageCollection.updateOne(
        { _id: doc._id },
        { 
          $set: { 
            dailyUsage: correctedDailyUsage 
          },
          // Remove the incorrectly nested fields if they exist
          $unset: {
            'dailyUsage.gemini-2': 1
          }
        }
      );

      console.log('   ✅ Fixed dailyUsage:', JSON.stringify(correctedDailyUsage, null, 2));
    }

    console.log('\n🎉 Migration complete!');
    console.log('📋 Summary:');
    console.log(`   - Fixed ${usageDocs.length} usage documents`);
    console.log('   - Changed field names from gemini-2.5-* to gemini-2_5-*');
    console.log('   - Reset all daily counts to 0');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

fixUsageData();
