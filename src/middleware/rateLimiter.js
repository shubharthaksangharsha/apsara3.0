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
    points: 10, // 10 connections
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
  })
};

// Helper function to get user subscription plan
const getUserSubscriptionPlan = async (userId) => {
  try {
    if (!userId) return 'guest';
    const user = await User.findById(userId);
    return user?.subscriptionPlan || 'guest';
  } catch (error) {
    console.error('Error fetching user subscription plan:', error);
    return 'guest';
  }
};

// Helper function to get file upload rate limiter based on subscription plan
const getFileUploadLimiter = async (req) => {
  const subscriptionPlan = await getUserSubscriptionPlan(req.userId);
  
  switch (subscriptionPlan) {
    case 'guest':
      return rateLimiters.fileUploadGuest;
    case 'free':
      return rateLimiters.fileUploadFree;
    case 'premium':
    case 'enterprise':
      return null; // Unlimited uploads for premium and enterprise
    default:
      return rateLimiters.fileUploadFree; // Default to free tier
  }
};

export const rateLimiter = async (req, res, next) => {
  try {
    // Extract userId from Authorization header for user-based rate limiting
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const jwt = await import('jsonwebtoken');
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId || decoded.id;
      } catch (error) {
        // Invalid token, treat as guest
        req.userId = null;
      }
    }

    // Skip rate limiting for specific endpoints
    const exemptPaths = [
      '/download', // File downloads
      '/api/conversations', // Loading conversations and messages
      '/api/files/', // Followed by fileId/download
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
      return req.path.includes(path);
    });

    if (isExempt) {
      console.log(`Rate limit exempted for: ${req.method} ${req.path}`);
      return next();
    }

    // Choose the appropriate rate limiter based on the endpoint
    let limiter = rateLimiters.api;
    let keyOverride = null;
    
    // AI generation endpoints (generate, regenerate, edit)
    if (req.path.includes('/generate') || 
        req.path.includes('/regenerate') || 
        req.path.includes('/edit') ||
        req.path.startsWith('/api/ai')) {
      limiter = rateLimiters.ai;
    }
    // File upload endpoints (not downloads) - Use user-based rate limiting
    else if (req.path.startsWith('/api/files') && 
             (req.method === 'POST' || req.path.includes('upload'))) {
      limiter = await getFileUploadLimiter(req);
      
      // If limiter is null (premium/enterprise), skip rate limiting
      if (!limiter) {
        console.log(`File upload rate limit exempted for premium/enterprise user: ${req.userId || req.ip}`);
        return next();
      }
    }
    // Authentication endpoints
    else if (req.path.includes('/auth') || 
             req.path.includes('/login') || 
             req.path.includes('/register')) {
      limiter = rateLimiters.auth;
    }
    // Message operations (send, edit, delete messages)
    else if (req.path.includes('/messages') && 
             (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')) {
      limiter = rateLimiters.messageOperations;
    }

    // Use appropriate key for rate limiting
    const key = keyOverride || (limiter.keyGenerator ? limiter.keyGenerator(req) : req.ip);
    await limiter.consume(key);
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

    console.error(`Rate limit exceeded for: ${req.method} ${req.path} from ${req.userId || req.ip}`);

    const error = new Error('Too many requests, please try again later');
    error.name = 'TooManyRequestsError';
    error.status = 429;
    error.retryAfter = timeRemaining;
    
    next(error);
  }
};

// Specific rate limiter for Live API WebSocket connections
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