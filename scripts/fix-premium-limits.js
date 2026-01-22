/**
 * Script to fix Premium user rate limits
 * Run this on the Oracle server to update your rate limits
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const userUsageSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  subscriptionPlan: String,
  dailyUsage: {
    date: String,
    'gemini-2_5-flash': {
      count: Number,
      limit: Number
    },
    'gemini-2_5-pro': {
      count: Number,
      limit: Number
    }
  }
});

const UserUsage = mongoose.model('UserUsage', userUsageSchema);

async function fixPremiumLimits() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/apsara-ai');
    console.log('✅ Connected to MongoDB');

    // SPECIFIC USER ID TO FIX
    const targetUserId = new mongoose.Types.ObjectId('693a33e03a9382971b17332f');
    
    console.log(`\n🎯 Targeting specific user: ${targetUserId}`);

    // Find the user's current usage record
    const userUsage = await UserUsage.findOne({ userId: targetUserId });

    if (!userUsage) {
      console.log('❌ User usage record not found! Creating a new one...');
      
      // Create a new usage record for the user
      await UserUsage.create({
        userId: targetUserId,
        subscriptionPlan: 'premium',
        dailyUsage: {
          date: new Date().toISOString().split('T')[0],
          'gemini-2_5-flash': { count: 0, limit: 100 },
          'gemini-2_5-pro': { count: 0, limit: 50 }
        }
      });
      
      console.log('✅ Created new usage record with premium limits');
    } else {
      console.log(`\n📊 Current limits for user ${targetUserId}:`);
      console.log(`   Flash: ${userUsage.dailyUsage?.['gemini-2_5-flash']?.limit || 'N/A'}`);
      console.log(`   Pro: ${userUsage.dailyUsage?.['gemini-2_5-pro']?.limit || 'N/A'}`);
      console.log(`   Subscription Plan: ${userUsage.subscriptionPlan || 'N/A'}`);

      // Update the user's limits
      await UserUsage.updateOne(
        { userId: targetUserId },
        {
          $set: {
            subscriptionPlan: 'premium',
            'dailyUsage.gemini-2_5-flash.limit': 100,
            'dailyUsage.gemini-2_5-pro.limit': 50,
            'dailyUsage.gemini-2_5-flash.count': 0, // Reset count
            'dailyUsage.gemini-2_5-pro.count': 0 // Reset count
          }
        }
      );

      console.log(`\n✅ Updated limits to Flash: 100, Pro: 50`);
    }

    // Also find and fix ALL premium users with wrong limits
    const premiumUsers = await UserUsage.find({
      subscriptionPlan: 'premium',
      $or: [
        { 'dailyUsage.gemini-2_5-flash.limit': { $ne: 100 } },
        { 'dailyUsage.gemini-2_5-pro.limit': { $ne: 50 } }
      ]
    });

    if (premiumUsers.length > 0) {
      console.log(`\n📊 Found ${premiumUsers.length} other premium users with incorrect limits`);

      // Update each user
      for (const user of premiumUsers) {
        if (user.userId.toString() === targetUserId.toString()) {
          continue; // Skip the user we already updated
        }
        
        console.log(`\n🔧 Fixing limits for user: ${user.userId}`);
        console.log(`   Old Flash limit: ${user.dailyUsage['gemini-2_5-flash']?.limit || 0}`);
        console.log(`   Old Pro limit: ${user.dailyUsage['gemini-2_5-pro']?.limit || 0}`);

        await UserUsage.updateOne(
          { userId: user.userId },
          {
            $set: {
              'dailyUsage.gemini-2_5-flash.limit': 100,
              'dailyUsage.gemini-2_5-pro.limit': 50,
              'dailyUsage.gemini-2_5-flash.count': 0, // Reset count
              'dailyUsage.gemini-2_5-pro.count': 0 // Reset count
            }
          }
        );

        console.log(`   ✅ Updated to Flash: 100, Pro: 50`);
      }
    }

    console.log(`\n🎉 Successfully updated ${premiumUsers.length} premium users!`);
    
    // Verify the update
    const verification = await UserUsage.findOne({ 
      subscriptionPlan: 'premium' 
    });
    
    if (verification) {
      console.log(`\n✅ Verification - Sample premium user limits:`);
      console.log(`   Flash: ${verification.dailyUsage['gemini-2_5-flash']?.limit}/day`);
      console.log(`   Pro: ${verification.dailyUsage['gemini-2_5-pro']?.limit}/day`);
    }

    await mongoose.disconnect();
    console.log('\n✅ Done! You can now use your premium limits.');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
fixPremiumLimits();
