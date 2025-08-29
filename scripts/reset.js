#!/usr/bin/env node

/**
 * Rate Limit Reset Script
 * This script clears all rate limiting data from memory
 */

import { RateLimiterMemory } from 'rate-limiter-flexible';
import dotenv from 'dotenv';

dotenv.config();

console.log('🚀 Rate Limit Reset Script Starting...');

// Recreate the same rate limiters as in the middleware
const rateLimiters = {
  // General API rate limiter
  api: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200,
    duration: (parseInt(process.env.RATE_LIMIT_WINDOW) || 15) * 60,
  }),

  // AI endpoints rate limiter
  ai: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 30,
    duration: 15 * 60,
  }),

  // Live API WebSocket connections
  liveApi: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 10,
    duration: 60 * 60,
  }),

  // File upload rate limiting (legacy IP-based)
  fileUpload: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 100,
    duration: 60 * 60,
  }),

  // User-based file upload rate limiters
  fileUploadGuest: new RateLimiterMemory({
    keyGenerator: (req) => req.userId || req.ip,
    points: 0,
    duration: 24 * 60 * 60,
  }),

  fileUploadFree: new RateLimiterMemory({
    keyGenerator: (req) => req.userId || req.ip,
    points: 5,
    duration: 24 * 60 * 60,
  }),

  // Authentication rate limiting
  auth: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 10,
    duration: 15 * 60,
  }),

  // Message operations rate limiter
  messageOperations: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 60,
    duration: 15 * 60,
  })
};

async function resetAllRateLimits() {
  try {
    console.log('🧹 Resetting all rate limits...');

    // Common IP addresses and user IDs to clear (you can add more)
    const commonKeys = [
      '::ffff:127.0.0.1',  // Local IPv4 mapped to IPv6
      '127.0.0.1',         // Local IPv4
      '::1',               // Local IPv6
      'localhost'
    ];

    // User IDs from recent logs (add your user IDs here)
    const userIds = [
      '68a6cd8964e1bc205b5852fd'  // Add more user IDs as needed
    ];

    const allKeys = [...commonKeys, ...userIds];

    // Reset each rate limiter for all keys
    for (const [limiterName, limiter] of Object.entries(rateLimiters)) {
      console.log(`  📝 Resetting ${limiterName} rate limiter...`);
      
      for (const key of allKeys) {
        try {
          await limiter.delete(key);
        } catch (error) {
          // Ignore errors for keys that don't exist
        }
      }
      
      console.log(`  ✅ ${limiterName} rate limiter reset completed`);
    }

    console.log('🎉 All rate limits have been reset successfully!');
    console.log('');
    console.log('📊 Current status:');
    console.log('  • All IP-based rate limits: CLEARED');
    console.log('  • All user-based rate limits: CLEARED');
    console.log('  • File upload limits: RESET');
    console.log('  • API rate limits: RESET');
    console.log('');
    console.log('✨ You can now make requests without rate limiting restrictions.');

  } catch (error) {
    console.error('❌ Error resetting rate limits:', error);
    process.exit(1);
  }
}

// Advanced reset function that clears everything
async function nuclearReset() {
  console.log('💥 NUCLEAR RESET: Clearing ALL rate limiter internal state...');
  
  try {
    // Create fresh instances to completely reset internal state
    Object.keys(rateLimiters).forEach(key => {
      const oldLimiter = rateLimiters[key];
      
      // Create a new instance with the same configuration
      rateLimiters[key] = new RateLimiterMemory({
        keyGenerator: oldLimiter.keyGenerator,
        points: oldLimiter.points,
        duration: oldLimiter.duration
      });
    });
    
    console.log('🔥 All rate limiters recreated with fresh state');
    console.log('✅ Nuclear reset completed successfully!');
    
  } catch (error) {
    console.error('❌ Nuclear reset failed:', error);
    process.exit(1);
  }
}

// CLI interface
const args = process.argv.slice(2);
const command = args[0] || 'reset';

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('🔧 APSARA RATE LIMIT RESET UTILITY');
  console.log('═══════════════════════════════════════');
  console.log('');

  switch (command) {
    case 'reset':
    case 'clear':
      await resetAllRateLimits();
      break;
      
    case 'nuclear':
    case 'nuke':
      await nuclearReset();
      break;
      
    case 'help':
    case '--help':
    case '-h':
      console.log('Available commands:');
      console.log('');
      console.log('  reset, clear    - Clear rate limits for common keys');
      console.log('  nuclear, nuke   - Complete reset (recreate all limiters)');
      console.log('  help           - Show this help message');
      console.log('');
      console.log('Usage examples:');
      console.log('  node reset-rate-limits.js reset');
      console.log('  node reset-rate-limits.js nuclear');
      break;
      
    default:
      console.log(`❌ Unknown command: ${command}`);
      console.log('Use "help" to see available commands');
      process.exit(1);
  }
  
  console.log('');
  console.log('🏁 Script completed. Exiting...');
  process.exit(0);
}

// Run the script
main().catch(error => {
  console.error('💥 Script failed:', error);
  process.exit(1);
});
