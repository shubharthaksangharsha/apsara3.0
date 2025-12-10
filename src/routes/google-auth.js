import express from 'express';
import Joi from 'joi';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { asyncHandler } from '../middleware/errorHandler.js';
import { googleAuthRateLimiter } from '../middleware/rateLimiter.js';
import User from '../models/User.js';

const router = express.Router();

// Google OAuth client for token verification
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '838558050964-icvtq1pjg8lcrqfselbuflon0uclcsot.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Validation schema for Google Sign-In
const googleAuthSchema = Joi.object({
  idToken: Joi.string().required(),
  email: Joi.string().email().required(),
  name: Joi.string().required(),
  profilePicture: Joi.string().uri().allow(null, '')
});

/**
 * @route POST /api/auth/google
 * @desc Authenticate user with Google Sign-In
 * @access Public (with rate limiting)
 * 
 * This handles:
 * 1. New users signing up with Google
 * 2. Existing Google users signing in
 * 3. Existing email/password users linking their Google account
 */
router.post('/google', googleAuthRateLimiter, asyncHandler(async (req, res) => {
  const { error, value } = googleAuthSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message
    });
  }

  const { idToken, email, name, profilePicture } = value;

  try {
    // Verify the Google ID token
    let googlePayload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: idToken,
        audience: GOOGLE_CLIENT_ID,
      });
      googlePayload = ticket.getPayload();
      
      // Verify email matches
      if (googlePayload.email !== email) {
        return res.status(401).json({
          success: false,
          message: 'Email verification failed'
        });
      }
    } catch (verifyError) {
      console.error('Google token verification failed:', verifyError.message);
      // In development, allow unverified tokens for testing
      if (process.env.NODE_ENV === 'production') {
        return res.status(401).json({
          success: false,
          message: 'Invalid Google token'
        });
      }
      // For development, create a mock payload
      googlePayload = {
        sub: `google_${Date.now()}`,
        email: email,
        name: name,
        picture: profilePicture,
        email_verified: true
      };
    }

    const googleId = googlePayload.sub;
    
    console.log(`🔐 Google Sign-In attempt for: ${email}`);
    console.log(`👤 User: ${name}`);
    console.log(`🆔 Google ID: ${googleId}`);

    // Check if user exists by Google ID first
    let user = await User.findOne({ googleId });
    
    if (!user) {
      // Check if user exists by email (could be email/password user)
      user = await User.findOne({ email: email.toLowerCase() });
      
      if (user) {
        // Existing user with this email - link Google account
        console.log(`🔗 Linking Google account to existing user: ${email}`);
        
        user.googleId = googleId;
        user.profilePicture = profilePicture || user.profilePicture;
        user.isEmailVerified = true; // Google verified the email
        
        // If user was local-only, now they have both options
        if (user.authProvider === 'local') {
          user.authProvider = 'local'; // Keep as local since they have a password
        }
        
        await user.save();
      } else {
        // New user - create account with Google
        console.log(`✨ Creating new user with Google: ${email}`);
        
        user = new User({
          fullName: name || googlePayload.name || email.split('@')[0],
          email: email.toLowerCase(),
          password: `google_${googleId}_${Date.now()}`, // Random placeholder password
          profilePicture: profilePicture || googlePayload.picture,
          googleId: googleId,
          authProvider: 'google',
          isEmailVerified: true, // Google verified the email
          subscriptionPlan: 'free',
          role: 'user'
        });
        
        await user.save();
      }
    } else {
      // Existing Google user - just update their info
      console.log(`👋 Welcome back Google user: ${email}`);
      
      user.profilePicture = profilePicture || user.profilePicture;
      user.usage.lastLogin = new Date();
      await user.save();
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user._id, 
        email: user.email,
        role: user.role 
      },
      process.env.JWT_SECRET || 'your-jwt-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: user.googleId && !user.authProvider === 'google' 
        ? 'Google account linked successfully' 
        : 'Google Sign-In successful',
      data: {
        user: {
          id: user._id,
          email: user.email,
          fullName: user.fullName,
          profilePicture: user.profilePicture,
          subscriptionPlan: user.subscriptionPlan,
          role: user.role,
          authProvider: user.authProvider,
          hasPassword: user.authProvider === 'local' || user.authProvider === 'both',
          isEmailVerified: user.isEmailVerified
        },
        token,
        expiresIn: '7d'
      }
    });

  } catch (error) {
    console.error('Google Sign-In Error:', error);
    res.status(500).json({
      success: false,
      message: 'Google Sign-In failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
}));

export default router;