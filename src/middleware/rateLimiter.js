import { RateLimiterMemory } from 'rate-limiter-flexible';
import dotenv from 'dotenv';
import User from '../models/User.js';

dotenv.config();

// Configure rate limiters for different endpoints
const rateLimiters = {
  // General API rate limiter (lighter for read operations)
  api: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200, // Increased for read operations
    duration: (parseInt(process.env.RATE_LIMIT_WINDOW) || 15) * 60, // 15 minutes
  }),

  // Stricter rate limiting for AI endpoints (generate/regenerate/edit)
  ai: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 30, // 30 AI requests
    duration: 15 * 60, // per 15 minutes
  }),

  // Very strict rate limiting for Live API WebSocket connections
  liveApi: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 100, // 100 connections per hour (increased for development)
    duration: 60 * 60, // per hour
  }),

  // Session/token endpoints (ephemeral tokens, etc.)
  sessions: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 50, // 50 session operations per hour
    duration: 60 * 60, // per hour
  }),

  // Tools/plugins endpoints
  tools: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 60, // 60 tool calls per 15 minutes
    duration: 15 * 60, // per 15 minutes
  }),

  // Conversation operations (create, delete, archive)
  conversationWrite: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 100, // 100 write operations per hour
    duration: 60 * 60, // per hour
  }),

  // File upload rate limiting (legacy IP-based for fallback)
  fileUpload: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 100, // 100 uploads
    duration: 60 * 60, // per hour
  }),

  // User-based file upload rate limiters by subscription plan
  fileUploadGuest: new RateLimiterMemory({
    keyGenerator: (req) => req.userId || req.ip,
    points: 0, // 0 uploads per day for guests
    duration: 24 * 60 * 60, // 24 hours
  }),

  fileUploadFree: new RateLimiterMemory({
    keyGenerator: (req) => req.userId || req.ip,
    points: 5, // 5 uploads per day for free users
    duration: 24 * 60 * 60, // 24 hours
  }),

  // Authentication rate limiting
  auth: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 10, // 10 attempts
    duration: 15 * 60, // per 15 minutes
  }),

  // Message operations (send, edit, delete)
  messageOperations: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 60, // 60 message operations
    duration: 15 * 60, // per 15 minutes
  }),

  // Google Auth operations (OAuth callbacks)
  googleAuth: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 20, // 20 auth attempts
    duration: 15 * 60, // per 15 minutes
  }),

  // User-based Live API rate limiters by subscription plan
  // Based on Google's Gemini Live API limits: Free tier has ~10 RPM, Paid has higher
  liveApiGuest: new RateLimiterMemory({
    keyGenerator: (req) => req.userId || req.ip,
    points: 3, // 3 Live sessions per day for guests (very limited)
    duration: 24 * 60 * 60, // 24 hours
  }),

  liveApiFree: new RateLimiterMemory({
    keyGenerator: (req) => req.userId || req.ip,
    points: 10, // 10 Live sessions per day for free users
    duration: 24 * 60 * 60, // 24 hours
  }),

  liveApiPremium: new RateLimiterMemory({
    keyGenerator: (req) => req.userId || req.ip,
    points: 100, // 100 Live sessions per day for premium
    duration: 24 * 60 * 60, // 24 hours
  }),

  // Per-minute rate limits for active Live sessions (prevent abuse)
  liveApiPerMinute: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 10, // 10 session creations per minute max
    duration: 60, // per minute
  })
};

// Helper function to get user subscription plan
const getUserSubscriptionPlan = async (userId) => {
  try {
    if (!userId) {
      console.log(`📋 Rate Limiter: No userId provided, returning guest`);
      return 'guest';
    }
    console.log(`📋 Rate Limiter: Fetching subscription plan for userId: ${userId}`);
    const user = await User.findById(userId);
    if (!user) {
      console.log(`⚠️ Rate Limiter: User not found for userId: ${userId}, returning guest`);
      return 'guest';
    }
    const plan = user.subscriptionPlan || 'guest';
    console.log(`📋 Rate Limiter: Found user with plan: ${plan}`);
    return plan;
  } catch (error) {
    console.error('❌ Rate Limiter: Error fetching user subscription plan:', error);
    return 'guest';
  }
};

// Helper function to get file upload rate limiter based on subscription plan
const getFileUploadLimiter = async (req) => {
  const subscriptionPlan = await getUserSubscriptionPlan(req.userId);
  console.log(`🎯 Rate Limiter: User ${req.userId || 'guest'} has subscription plan: ${subscriptionPlan}`);
  
  switch (subscriptionPlan) {
    case 'guest':
      console.log(`👤 Rate Limiter: Applying guest rate limiter (0 uploads)`);
      return rateLimiters.fileUploadGuest;
    case 'free':
      console.log(`🆓 Rate Limiter: Applying free rate limiter (5 uploads/day)`);
      return rateLimiters.fileUploadFree;
    case 'premium':
    case 'enterprise':
      console.log(`💎 Rate Limiter: Unlimited uploads for ${subscriptionPlan} user`);
      return null; // Unlimited uploads for premium and enterprise
    default:
      console.log(`⚠️ Rate Limiter: Unknown plan ${subscriptionPlan}, defaulting to free tier`);
      return rateLimiters.fileUploadFree; // Default to free tier
  }
};

export const rateLimiter = async (req, res, next) => {
  // Define these outside try block to avoid scope issues
  let limiter = rateLimiters.api;
  let key = req.ip; // Default to IP
  
  try {
    // Extract userId from Authorization header for user-based rate limiting
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const jwt = await import('jsonwebtoken');
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.id || decoded.userId; // Try both fields
        console.log(`🔍 Rate Limiter: Extracted userId: ${req.userId} from token`);
      } catch (error) {
        // Invalid token, treat as guest
        req.userId = null;
        console.log(`⚠️ Rate Limiter: Invalid token, treating as guest: ${error.message}`);
      }
    } else {
      req.userId = null;
      console.log(`⚠️ Rate Limiter: No auth header found, treating as guest`);
    }
    
    // Skip rate limiting for specific endpoints
    const exemptPaths = [
      '/download', // File downloads
      '/api/conversations', // Loading conversations and messages
      '/api/files/', // Followed by fileId/download
      '/api/files/upload-limits', // Upload limits checking (read-only)
    ];

    // Check if this request should be exempted
    const isExempt = exemptPaths.some(path => {
      if (path === '/download') {
        return req.path.endsWith('/download');
      }
      if (path === '/api/conversations') {
        return req.path.startsWith('/api/conversations') && req.method === 'GET';
      }
      if (path === '/api/files/') {
        return req.path.startsWith('/api/files/') && req.path.endsWith('/download');
      }
      if (path === '/api/files/upload-limits') {
        return req.path === '/api/files/upload-limits' && req.method === 'GET';
      }
      return req.path.includes(path);
    });

    if (isExempt) {
      console.log(`Rate limit exempted for: ${req.method} ${req.path}`);
      return next();
    }

    // Choose the appropriate rate limiter based on the endpoint
    console.log(`🎯 Rate Limiter: Processing ${req.method} ${req.path} for user ${req.userId || 'guest'}`);
    
    // AI generation endpoints (generate, regenerate, edit)
    if (req.path.includes('/generate') || 
        req.path.includes('/regenerate') || 
        req.path.includes('/edit') ||
        req.path.startsWith('/api/ai')) {
      limiter = rateLimiters.ai;
      key = req.ip; // Use IP for AI endpoints
      console.log(`🤖 Rate Limiter: Using AI rate limiter`);
    }
    // File upload endpoints (not downloads) - Use user-based rate limiting
    else if (req.path.startsWith('/api/files') && 
             (req.method === 'POST' || req.path.includes('upload'))) {
      console.log(`🔄 Rate Limiter: Processing file upload for userId: ${req.userId || 'guest'}`);
      
      // Early check for premium/enterprise users - completely bypass rate limiting
      if (req.userId) {
        const subscriptionPlan = await getUserSubscriptionPlan(req.userId);
        if (subscriptionPlan === 'premium' || subscriptionPlan === 'enterprise') {
          console.log(`💎 Rate Limiter: EARLY BYPASS for ${subscriptionPlan} user ${req.userId}`);
          return next();
        }
      }
      
      limiter = await getFileUploadLimiter(req);
      
      // If limiter is null (premium/enterprise), skip rate limiting
      if (!limiter) {
        console.log(`✅ File upload rate limit exempted for premium/enterprise user: ${req.userId || req.ip}`);
        return next();
      } else {
        // Use userId as key for file uploads, fallback to IP for guests
        key = req.userId || req.ip;
        console.log(`🔒 File upload rate limiter applied for user: ${req.userId || req.ip}`);
      }
    }
    // Authentication endpoints
    else if (req.path.includes('/auth') || 
             req.path.includes('/login') || 
             req.path.includes('/register')) {
      limiter = rateLimiters.auth;
      key = req.ip; // Use IP for auth endpoints
    }
    // Message operations (send, edit, delete messages)
    else if (req.path.includes('/messages') && 
             (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')) {
      limiter = rateLimiters.messageOperations;
      key = req.ip; // Use IP for message operations
    }
    // Session/token operations
    else if (req.path.includes('/session') || req.path.includes('/token')) {
      limiter = rateLimiters.sessions;
      key = req.ip; // Use IP for session operations
    }
    // Tools/plugins operations
    else if (req.path.includes('/tools') || req.path.includes('/plugins')) {
      limiter = rateLimiters.tools;
      key = req.ip; // Use IP for tools/plugins operations
    }
    // Conversation write operations
    else if (req.path.includes('/conversations') && 
             (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PATCH')) {
      limiter = rateLimiters.conversationWrite;
      key = req.ip; // Use IP for conversation write operations
    }

    console.log(`🔑 Rate Limiter: Using key '${key}' for ${req.method} ${req.path}`);
    
    // Debug rate limit state before consuming
    if (req.path.startsWith('/api/files') && req.method === 'POST') {
      await debugRateLimit(req.userId, req.ip);
    }
    
    await limiter.consume(key);
    console.log(`✅ Rate Limiter: Request allowed for key '${key}'`);
    next();
  } catch (rejRes) {
    const totalHits = rejRes.totalTime || 0;
    const timeRemaining = Math.round(rejRes.msBeforeNext / 1000) || 1;

    res.set({
      'Retry-After': timeRemaining,
      'X-RateLimit-Limit': rejRes.points || rateLimiters.api.points,
      'X-RateLimit-Remaining': rejRes.remainingPoints || 0,
      'X-RateLimit-Reset': new Date(Date.now() + rejRes.msBeforeNext)
    });

    console.error(`❌ Rate limit exceeded for: ${req.method} ${req.path} from ${req.userId || req.ip}`);
    console.error(`   Limiter details: points=${rejRes.points}, remaining=${rejRes.remainingPoints}, retryAfter=${timeRemaining}s`);
    console.error(`   Key used: ${key}`);

    const error = new Error('Too many requests, please try again later');
    error.name = 'TooManyRequestsError';
    error.status = 429;
    error.retryAfter = timeRemaining;
    
    next(error);
  }
};

// Specific rate limiter for Live API WebSocket connections (IP-based fallback)
export const liveApiRateLimiter = async (ip) => {
  try {
    await rateLimiters.liveApi.consume(ip);
    return { success: true };
  } catch (rejRes) {
    return {
      success: false,
      retryAfter: Math.round(rejRes.msBeforeNext / 1000) || 1,
      remainingPoints: rejRes.remainingPoints || 0
    };
  }
};

/**
 * User-based Live API rate limiter
 * Checks both per-minute and daily limits based on subscription plan
 * @param {string} userId - User ID (null for guests)
 * @param {string} ip - Client IP address
 * @returns {Object} { success, retryAfter, remainingPoints, limit, message }
 */
export const liveApiUserRateLimiter = async (userId, ip) => {
  try {
    // First check per-minute rate limit (prevent burst abuse)
    try {
      await rateLimiters.liveApiPerMinute.consume(ip);
    } catch (rejRes) {
      console.log(`⚡ Live API: Per-minute rate limit exceeded for IP: ${ip}`);
      return {
        success: false,
        retryAfter: Math.round(rejRes.msBeforeNext / 1000) || 1,
        remainingPoints: 0,
        limit: rateLimiters.liveApiPerMinute.points,
        message: 'Too many Live API requests. Please wait a moment.',
        limitType: 'per_minute'
      };
    }

    // Get subscription plan and appropriate limiter
    const subscriptionPlan = await getUserSubscriptionPlan(userId);
    const key = userId || ip;
    
    let limiter;
    let dailyLimit;
    
    switch (subscriptionPlan) {
      case 'guest':
        limiter = rateLimiters.liveApiGuest;
        dailyLimit = 3;
        break;
      case 'free':
        limiter = rateLimiters.liveApiFree;
        dailyLimit = 10;
        break;
      case 'premium':
      case 'enterprise':
        limiter = rateLimiters.liveApiPremium;
        dailyLimit = 100;
        break;
      default:
        limiter = rateLimiters.liveApiFree;
        dailyLimit = 10;
    }
    
    // Check daily limit
    await limiter.consume(key);
    
    // Get remaining points
    const rateLimiterRes = await limiter.get(key);
    const remainingPoints = rateLimiterRes ? rateLimiterRes.remainingPoints : dailyLimit;
    
    console.log(`✅ Live API: Session allowed for ${subscriptionPlan} user ${key}, ${remainingPoints}/${dailyLimit} remaining`);
    
    return {
      success: true,
      remainingPoints,
      limit: dailyLimit,
      subscriptionPlan,
      message: `${remainingPoints} Live sessions remaining today`
    };
    
  } catch (rejRes) {
    const retryAfter = Math.round(rejRes.msBeforeNext / 1000) || 1;
    const hoursUntilReset = Math.ceil(retryAfter / 3600);
    
    console.log(`❌ Live API: Daily rate limit exceeded for userId: ${userId}, IP: ${ip}`);
    
    return {
      success: false,
      retryAfter,
      remainingPoints: 0,
      limit: rejRes.points || 0,
      message: `Daily Live API limit reached. Resets in ${hoursUntilReset} hour${hoursUntilReset !== 1 ? 's' : ''}.`,
      limitType: 'daily'
    };
  }
};

/**
 * Get Live API rate limit info for a user (for status display)
 */
export const getLiveApiLimitInfo = async (userId) => {
  try {
    const subscriptionPlan = await getUserSubscriptionPlan(userId);
    const key = userId || 'guest';
    
    let limiter;
    let limit;
    
    switch (subscriptionPlan) {
      case 'guest':
        limiter = rateLimiters.liveApiGuest;
        limit = 3;
        break;
      case 'free':
        limiter = rateLimiters.liveApiFree;
        limit = 10;
        break;
      case 'premium':
      case 'enterprise':
        limiter = rateLimiters.liveApiPremium;
        limit = 100;
        break;
      default:
        limiter = rateLimiters.liveApiFree;
        limit = 10;
    }
    
    const rateLimiterRes = await limiter.get(key);
    const used = rateLimiterRes ? (limit - rateLimiterRes.remainingPoints) : 0;
    const remaining = rateLimiterRes ? rateLimiterRes.remainingPoints : limit;
    const retryAfterSeconds = rateLimiterRes && remaining <= 0 ? 
      Math.round(rateLimiterRes.msBeforeNext / 1000) : null;
    
    return {
      canUse: remaining > 0,
      used,
      limit,
      remaining,
      retryAfterSeconds,
      subscriptionPlan,
      message: remaining > 0 
        ? `${remaining} Live sessions remaining today`
        : `Daily limit reached. Upgrade to Premium for more sessions.`
    };
  } catch (error) {
    console.error('Error getting Live API limit info:', error);
    return {
      canUse: false,
      used: 0,
      limit: 0,
      remaining: 0,
      retryAfterSeconds: null,
      subscriptionPlan: 'unknown',
      message: 'Error checking Live API limits'
    };
  }
};

// Get remaining points for a specific IP and limiter
export const getRemainingPoints = async (ip, limiterType = 'api') => {
  try {
    const limiter = rateLimiters[limiterType];
    if (!limiter) return null;
    
    const resRateLimiter = await limiter.get(ip);
    return {
      remainingPoints: resRateLimiter ? resRateLimiter.remainingPoints : limiter.points,
      msBeforeNext: resRateLimiter ? resRateLimiter.msBeforeNext : 0,
      totalHits: resRateLimiter ? resRateLimiter.totalHits : 0
    };
  } catch (error) {
    console.error('Error getting remaining points:', error);
    return null;
  }
};

// Clear rate limit state for a user (useful when subscription is upgraded)
export const clearUserRateLimit = async (userId) => {
  if (!userId) return;
  
  try {
    console.log(`🧹 Rate Limiter: Clearing rate limit state for user ${userId}`);
    
    // Clear from all user-based rate limiters
    await rateLimiters.fileUploadGuest.delete(userId);
    await rateLimiters.fileUploadFree.delete(userId);
    
    console.log(`✅ Rate Limiter: Cleared rate limit state for user ${userId}`);
  } catch (error) {
    console.error(`❌ Rate Limiter: Error clearing rate limit state for user ${userId}:`, error);
  }
};

// Debug function to check rate limit state
export const debugRateLimit = async (userId, ip) => {
  try {
    console.log(`🔍 Debug Rate Limit State for userId: ${userId}, ip: ${ip}`);
    
    if (userId) {
      const guestState = await rateLimiters.fileUploadGuest.get(userId);
      const freeState = await rateLimiters.fileUploadFree.get(userId);
      
      console.log(`  Guest limiter state: ${guestState ? `${guestState.remainingPoints}/${rateLimiters.fileUploadGuest.points}` : 'no state'}`);
      console.log(`  Free limiter state: ${freeState ? `${freeState.remainingPoints}/${rateLimiters.fileUploadFree.points}` : 'no state'}`);
    }
    
    const ipState = await rateLimiters.fileUpload.get(ip);
    console.log(`  IP limiter state: ${ipState ? `${ipState.remainingPoints}/${rateLimiters.fileUpload.points}` : 'no state'}`);
    
  } catch (error) {
    console.error(`❌ Debug Rate Limit error:`, error);
  }
};

// Get file upload rate limit information for a user
export const getFileUploadLimitInfo = async (userId) => {
  try {
    const subscriptionPlan = await getUserSubscriptionPlan(userId);
    
    // Premium and Enterprise have unlimited uploads
    if (subscriptionPlan === 'premium' || subscriptionPlan === 'enterprise') {
      return {
        canUpload: true,
        used: 0,
        limit: -1, // -1 indicates unlimited
        retryAfterSeconds: null,
        message: `Unlimited uploads for ${subscriptionPlan} users`,
        subscriptionPlan
      };
    }
    
    // Get the appropriate limiter
    const limiter = await getFileUploadLimiter({ userId });
    if (!limiter) {
      // This shouldn't happen but handle gracefully
      return {
        canUpload: true,
        used: 0,
        limit: -1,
        retryAfterSeconds: null,
        message: 'Unlimited uploads',
        subscriptionPlan
      };
    }
    
    // Get current usage
    const key = userId || 'guest';
    const resRateLimiter = await limiter.get(key);
    
    const limit = limiter.points;
    const used = resRateLimiter ? (limit - resRateLimiter.remainingPoints) : 0;
    const remaining = resRateLimiter ? resRateLimiter.remainingPoints : limit;
    const canUpload = remaining > 0;
    const retryAfterSeconds = resRateLimiter && !canUpload ? 
      Math.round(resRateLimiter.msBeforeNext / 1000) : null;
    
    let message;
    if (subscriptionPlan === 'guest') {
      message = 'Guests cannot upload files. Please sign up for a free account.';
    } else if (canUpload) {
      message = `${remaining} uploads remaining today`;
    } else {
      const hoursUntilReset = Math.ceil((retryAfterSeconds || 0) / 3600);
      message = `Daily upload limit reached. Resets in ${hoursUntilReset} hour${hoursUntilReset !== 1 ? 's' : ''}`;
    }
    
    return {
      canUpload,
      used,
      limit,
      retryAfterSeconds,
      message,
      subscriptionPlan
    };
  } catch (error) {
    console.error('Error getting file upload limit info:', error);
    return {
      canUpload: false,
      used: 0,
      limit: 0,
      retryAfterSeconds: null,
      message: 'Error checking upload limits',
      subscriptionPlan: 'unknown'
    };
  }
};

// ========== SPECIFIC RATE LIMITER MIDDLEWARES ==========
// These can be imported and applied to specific routes

/**
 * Helper function to set rate limit headers on response
 */
const setRateLimitHeaders = (res, limiter, rateLimiterRes) => {
  if (rateLimiterRes) {
    res.set({
      'X-RateLimit-Limit': limiter.points,
      'X-RateLimit-Remaining': rateLimiterRes.remainingPoints,
      'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString()
    });
  }
};

/**
 * Helper function to handle rate limit error response
 */
const handleRateLimitError = (res, rejRes) => {
  const timeRemaining = Math.round(rejRes.msBeforeNext / 1000) || 1;
  res.set({
    'Retry-After': timeRemaining,
    'X-RateLimit-Limit': rejRes.points || 0,
    'X-RateLimit-Remaining': 0,
    'X-RateLimit-Reset': new Date(Date.now() + rejRes.msBeforeNext).toISOString()
  });
  
  return res.status(429).json({
    success: false,
    error: {
      message: 'Too many requests, please try again later',
      retryAfter: timeRemaining
    }
  });
};

/**
 * Session/Token rate limiter middleware
 * For ephemeral token creation and session operations
 * 50 requests per hour per IP
 */
export const sessionRateLimiter = async (req, res, next) => {
  try {
    const key = req.ip;
    await rateLimiters.sessions.consume(key);
    
    // Set headers on success
    const rateLimiterRes = await rateLimiters.sessions.get(key);
    setRateLimitHeaders(res, rateLimiters.sessions, rateLimiterRes);
    
    next();
  } catch (rejRes) {
    console.error(`❌ Session rate limit exceeded for IP: ${req.ip}`);
    return handleRateLimitError(res, rejRes);
  }
};

/**
 * AI generation rate limiter middleware
 * For /generate, /regenerate, /edit endpoints
 * 30 requests per 15 minutes per IP
 */
export const aiRateLimiter = async (req, res, next) => {
  try {
    const key = req.ip;
    await rateLimiters.ai.consume(key);
    
    const rateLimiterRes = await rateLimiters.ai.get(key);
    setRateLimitHeaders(res, rateLimiters.ai, rateLimiterRes);
    
    next();
  } catch (rejRes) {
    console.error(`❌ AI rate limit exceeded for IP: ${req.ip}`);
    return handleRateLimitError(res, rejRes);
  }
};

/**
 * Auth rate limiter middleware
 * For login, register, password reset
 * 10 requests per 15 minutes per IP
 */
export const authRateLimiter = async (req, res, next) => {
  try {
    const key = req.ip;
    await rateLimiters.auth.consume(key);
    
    const rateLimiterRes = await rateLimiters.auth.get(key);
    setRateLimitHeaders(res, rateLimiters.auth, rateLimiterRes);
    
    next();
  } catch (rejRes) {
    console.error(`❌ Auth rate limit exceeded for IP: ${req.ip}`);
    return handleRateLimitError(res, rejRes);
  }
};

/**
 * Google Auth rate limiter middleware
 * For Google OAuth callbacks
 * 20 requests per 15 minutes per IP
 */
export const googleAuthRateLimiter = async (req, res, next) => {
  try {
    const key = req.ip;
    await rateLimiters.googleAuth.consume(key);
    
    const rateLimiterRes = await rateLimiters.googleAuth.get(key);
    setRateLimitHeaders(res, rateLimiters.googleAuth, rateLimiterRes);
    
    next();
  } catch (rejRes) {
    console.error(`❌ Google Auth rate limit exceeded for IP: ${req.ip}`);
    return handleRateLimitError(res, rejRes);
  }
};

/**
 * Tools/Plugins rate limiter middleware
 * For plugin execution
 * 60 requests per 15 minutes per IP
 */
export const toolsRateLimiter = async (req, res, next) => {
  try {
    const key = req.ip;
    await rateLimiters.tools.consume(key);
    
    const rateLimiterRes = await rateLimiters.tools.get(key);
    setRateLimitHeaders(res, rateLimiters.tools, rateLimiterRes);
    
    next();
  } catch (rejRes) {
    console.error(`❌ Tools rate limit exceeded for IP: ${req.ip}`);
    return handleRateLimitError(res, rejRes);
  }
};

/**
 * Conversation write rate limiter middleware
 * For create, delete, archive operations
 * 100 requests per hour per IP
 */
export const conversationWriteRateLimiter = async (req, res, next) => {
  try {
    const key = req.ip;
    await rateLimiters.conversationWrite.consume(key);
    
    const rateLimiterRes = await rateLimiters.conversationWrite.get(key);
    setRateLimitHeaders(res, rateLimiters.conversationWrite, rateLimiterRes);
    
    next();
  } catch (rejRes) {
    console.error(`❌ Conversation write rate limit exceeded for IP: ${req.ip}`);
    return handleRateLimitError(res, rejRes);
  }
};

/**
 * Message operations rate limiter middleware
 * For send, edit, delete messages
 * 60 requests per 15 minutes per IP
 */
export const messageRateLimiter = async (req, res, next) => {
  try {
    const key = req.ip;
    await rateLimiters.messageOperations.consume(key);
    
    const rateLimiterRes = await rateLimiters.messageOperations.get(key);
    setRateLimitHeaders(res, rateLimiters.messageOperations, rateLimiterRes);
    
    next();
  } catch (rejRes) {
    console.error(`❌ Message rate limit exceeded for IP: ${req.ip}`);
    return handleRateLimitError(res, rejRes);
  }
};

/**
 * File upload rate limiter middleware (user-based)
 * Subscription-aware: guest (0), free (5/day), premium (unlimited)
 */
export const fileUploadRateLimiter = async (req, res, next) => {
  try {
    // Extract userId from Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const jwt = await import('jsonwebtoken');
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.id || decoded.userId;
      } catch (error) {
        req.userId = null;
      }
    }
    
    // Check for premium/enterprise - bypass rate limiting
    if (req.userId) {
      const subscriptionPlan = await getUserSubscriptionPlan(req.userId);
      if (subscriptionPlan === 'premium' || subscriptionPlan === 'enterprise') {
        console.log(`💎 File upload: BYPASS for ${subscriptionPlan} user ${req.userId}`);
        return next();
      }
    }
    
    const limiter = await getFileUploadLimiter(req);
    if (!limiter) {
      return next(); // Unlimited
    }
    
    const key = req.userId || req.ip;
    await limiter.consume(key);
    
    const rateLimiterRes = await limiter.get(key);
    setRateLimitHeaders(res, limiter, rateLimiterRes);
    
    next();
  } catch (rejRes) {
    console.error(`❌ File upload rate limit exceeded for: ${req.userId || req.ip}`);
    return handleRateLimitError(res, rejRes);
  }
};

/**
 * Get rate limit status for a specific limiter type
 * Useful for debugging and monitoring
 */
export const getRateLimitStatus = async (ip, limiterType = 'api') => {
  const limiter = rateLimiters[limiterType];
  if (!limiter) {
    return { error: `Unknown limiter type: ${limiterType}` };
  }
  
  try {
    const rateLimiterRes = await limiter.get(ip);
    return {
      limiterType,
      limit: limiter.points,
      remaining: rateLimiterRes ? rateLimiterRes.remainingPoints : limiter.points,
      used: rateLimiterRes ? (limiter.points - rateLimiterRes.remainingPoints) : 0,
      resetAt: rateLimiterRes ? new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString() : null
    };
  } catch (error) {
    return { error: error.message };
  }
};