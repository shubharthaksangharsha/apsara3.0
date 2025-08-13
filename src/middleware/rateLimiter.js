import { RateLimiterMemory } from 'rate-limiter-flexible';
import dotenv from 'dotenv';

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

  // File upload rate limiting (only for uploads, not downloads)
  fileUpload: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 20, // 20 uploads
    duration: 60 * 60, // per hour
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

export const rateLimiter = async (req, res, next) => {
  try {
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
    
    // AI generation endpoints (generate, regenerate, edit)
    if (req.path.includes('/generate') || 
        req.path.includes('/regenerate') || 
        req.path.includes('/edit') ||
        req.path.startsWith('/api/ai')) {
      limiter = rateLimiters.ai;
    }
    // File upload endpoints (not downloads)
    else if (req.path.startsWith('/api/files') && 
             (req.method === 'POST' || req.path.includes('upload'))) {
      limiter = rateLimiters.fileUpload;
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

    await limiter.consume(req.ip);
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

    console.error(`Rate limit exceeded for: ${req.method} ${req.path} from ${req.ip}`);

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