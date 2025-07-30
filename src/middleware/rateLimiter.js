import { RateLimiterMemory } from 'rate-limiter-flexible';
import dotenv from 'dotenv';

dotenv.config();

// Configure rate limiters for different endpoints
const rateLimiters = {
  // General API rate limiter
  api: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    duration: (parseInt(process.env.RATE_LIMIT_WINDOW) || 15) * 60, // 15 minutes
  }),

  // Stricter rate limiting for AI endpoints
  ai: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 50, // 50 requests
    duration: 15 * 60, // per 15 minutes
  }),

  // Very strict rate limiting for Live API WebSocket connections
  liveApi: new RateLimiterMemory({
    keyGenerator: (req) => req.ip,
    points: 10, // 10 connections
    duration: 60 * 60, // per hour
  }),

  // File upload rate limiting
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
  })
};

export const rateLimiter = async (req, res, next) => {
  try {
    // Choose the appropriate rate limiter based on the endpoint
    let limiter = rateLimiters.api;
    
    if (req.path.startsWith('/api/ai')) {
      limiter = rateLimiters.ai;
    } else if (req.path.startsWith('/api/files')) {
      limiter = rateLimiters.fileUpload;
    } else if (req.path.includes('/auth') || req.path.includes('/login') || req.path.includes('/register')) {
      limiter = rateLimiters.auth;
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