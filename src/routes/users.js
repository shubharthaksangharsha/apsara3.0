import express from 'express';
import User from '../models/User.js';
import UserUsage from '../models/UserUsage.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import emailService from '../services/emailService.js';
import Joi from 'joi';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { clearUserRateLimit, authRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Validation schemas
const registerSchema = Joi.object({
  fullName: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  acceptTerms: Joi.boolean().valid(true).required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required()
});

const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  password: Joi.string().min(6).required()
});

const guestLoginSchema = Joi.object({
  sessionId: Joi.string().optional()
});

const googleAuthSchema = Joi.object({
  idToken: Joi.string().required(),
  accessToken: Joi.string().optional()
});

// Auth middleware
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret-key');
    
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token. User not found.' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid token.' 
    });
  }
};

// Register a new user (with rate limiting)
router.post('/register', authRateLimiter, async (req, res) => {
  try {
    // Validate request body
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        details: error.details[0].message
      });
    }

    const { fullName, email, password } = value;

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create new user
    const user = new User({
      fullName,
      email: email.toLowerCase(),
      password
    });

    // Generate email verification OTP
    const verificationOTP = user.generateEmailVerificationOTP();
    await user.save();

    // Send verification OTP
    const emailResult = await emailService.sendVerificationOTP(
      user.email,
      user.fullName,
      verificationOTP
    );

    if (!emailResult.success) {
      console.error('Failed to send verification OTP:', emailResult.error);
      // Still proceed with registration, user can resend verification
    }

    // Generate auth token
    const token = user.generateAuthToken();

    res.status(201).json({
      success: true,
      message: 'User registered successfully! Please check your email to verify your account.',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          isEmailVerified: user.isEmailVerified,
          role: user.role,
          subscriptionPlan: user.subscriptionPlan,
          createdAt: user.createdAt
        },
        token,
        emailSent: emailResult.success
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error during registration'
    });
  }
});

// Login user (with rate limiting)
router.post('/login', authRateLimiter, async (req, res) => {
  try {
    // Validate request body
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        details: error.details[0].message
      });
    }

    const { email, password } = value;

    // Find user with password field
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if this is a Google-only account (no password set)
    if (user.authProvider === 'google' && !user.password.startsWith('$2')) {
      return res.status(401).json({
        success: false,
        message: 'This account uses Google Sign-In. Please use the "Continue with Google" button to log in.',
        code: 'GOOGLE_ACCOUNT_ONLY'
      });
    }

    // Check if account is locked
    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked due to too many failed login attempts. Please try again later.'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      await user.handleFailedLogin();
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Handle successful login
    await user.handleSuccessfulLogin();

    // Generate auth token
    const token = user.generateAuthToken();

  res.json({
    success: true,
      message: 'Login successful',
      data: {
    user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          isEmailVerified: user.isEmailVerified,
          role: user.role,
          subscriptionPlan: user.subscriptionPlan,
          preferences: user.preferences,
          usage: user.usage
        },
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during login'
    });
    }
  });

// Guest login - creates a temporary user with limited access (with rate limiting)
router.post('/guest-login', authRateLimiter, async (req, res) => {
  try {
    const { error, value } = guestLoginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        details: error.details[0].message
      });
    }

    const { sessionId } = value;
    let guestUser;

    // Check if guest user already exists for this session
    if (sessionId) {
      guestUser = await User.findOne({ 
        email: { $regex: `^guest-${sessionId}@` },
        subscriptionPlan: 'guest'
      });
    }

    if (!guestUser) {
      // Create new guest user
      const guestId = sessionId || uuidv4().split('-')[0];
      const guestEmail = `guest-${guestId}@apsara.local`;
      
      guestUser = new User({
        fullName: `Guest User ${guestId}`,
        email: guestEmail,
        password: uuidv4(), // Random password
        subscriptionPlan: 'guest',
        role: 'guest',
        isEmailVerified: true, // Guests don't need email verification
        isGuest: true,
        guestSessionId: guestId
      });

      await guestUser.save();

      // Create usage tracking for guest
      await UserUsage.findOrCreateUsage(guestUser._id, 'guest');
    }

    // Create JWT token
    const token = jwt.sign(
      { 
        id: guestUser._id,
        email: guestUser.email,
        role: guestUser.role,
        isGuest: true
      },
      process.env.JWT_SECRET || 'default-secret-key',
      { expiresIn: '24h' } // Guest sessions expire in 24 hours
    );

    // Get usage information
    const userUsage = await UserUsage.findOne({ userId: guestUser._id });
    
    res.json({
      success: true,
      message: 'Guest session created successfully',
      data: {
        token,
        user: {
          id: guestUser._id,
          fullName: guestUser.fullName,
          email: guestUser.email,
          role: guestUser.role,
          subscriptionPlan: guestUser.subscriptionPlan,
          isGuest: true,
          sessionId: guestUser.guestSessionId
        },
        limitations: {
          totalMessagesLimit: 5,
          totalMessagesUsed: userUsage?.guestLimits?.totalMessagesUsed || 0,
          remainingMessages: 5 - (userUsage?.guestLimits?.totalMessagesUsed || 0),
          availableModels: ['gemini-2.5-flash'],
          sessionDuration: '24 hours'
        }
      }
    });

  } catch (error) {
    console.error('Guest login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during guest login'
    });
  }
});

// Google OAuth login
router.post('/google-auth', async (req, res) => {
  try {
    const { error, value } = googleAuthSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        details: error.details[0].message
      });
    }

    const { idToken, accessToken } = value;

    // Note: In a real implementation, you would verify the Google ID token
    // using Google's token verification service. For now, we'll simulate this.
    
    // Placeholder for Google token verification
    // const googleUser = await verifyGoogleToken(idToken);
    
    // For demo purposes, we'll create a mock Google user response
    // In production, replace this with actual Google API verification
    const mockGoogleUser = {
      sub: 'google_' + Math.random().toString(36).substr(2, 9),
      email: req.body.email || 'user@gmail.com',
      name: req.body.name || 'Google User',
      picture: req.body.picture || null,
      email_verified: true
    };

    if (!mockGoogleUser.email_verified) {
      return res.status(400).json({
        success: false,
        message: 'Google account email not verified'
      });
    }

    // Check if user already exists
    let user = await User.findOne({ 
      $or: [
        { email: mockGoogleUser.email.toLowerCase() },
        { googleId: mockGoogleUser.sub }
      ]
    });

    if (!user) {
      // Create new user from Google account
      user = new User({
        fullName: mockGoogleUser.name,
        email: mockGoogleUser.email.toLowerCase(),
        password: uuidv4(), // Random password (won't be used)
        subscriptionPlan: 'free',
        role: 'user',
        isEmailVerified: true, // Google accounts are pre-verified
        googleId: mockGoogleUser.sub,
        profilePicture: mockGoogleUser.picture,
        authProvider: 'google'
      });

      await user.save();

      // Create usage tracking
      await UserUsage.findOrCreateUsage(user._id, 'free');

      // Send welcome email
      try {
        await emailService.sendWelcomeEmail(user.email, user.fullName);
      } catch (emailError) {
        console.error('Failed to send welcome email:', emailError);
      }
    } else {
      // Update existing user with Google info if needed
      if (!user.googleId) {
        user.googleId = mockGoogleUser.sub;
        user.authProvider = 'google';
        if (mockGoogleUser.picture && !user.profilePicture) {
          user.profilePicture = mockGoogleUser.picture;
        }
        await user.save();
      }
    }

    // Create JWT token
    const token = jwt.sign(
      { 
        id: user._id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET || 'default-secret-key',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Get usage information
    const userUsage = await UserUsage.findOne({ userId: user._id });
    
    res.json({
      success: true,
      message: user.isNew ? 'Account created and logged in successfully' : 'Logged in successfully',
      data: {
        token,
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          subscriptionPlan: user.subscriptionPlan,
          profilePicture: user.profilePicture,
          authProvider: user.authProvider
        },
        usageInfo: userUsage ? {
          dailyUsage: userUsage.dailyUsage,
          totalUsage: userUsage.totalUsage,
          subscriptionPlan: userUsage.subscriptionPlan
        } : null
      }
    });

  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during Google authentication'
    });
  }
});

// Verify email via GET (for email link clicks)
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Email Verification - Apsara AI</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
            .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
            .error { color: #e74c3c; }
            .logo { width: 60px; height: 60px; margin: 0 auto 20px; background: #6750A4; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 24px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo">A</div>
            <h1 class="error">Verification Failed</h1>
            <p>No verification token provided. Please check the link in your email.</p>
            <p><a href="#" onclick="window.close()">Close this window</a></p>
          </div>
        </body>
        </html>
      `);
    }

    // Find user with this token
    const user = await User.findOne({ 
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Email Verification - Apsara AI</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
            .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
            .error { color: #e74c3c; }
            .logo { width: 60px; height: 60px; margin: 0 auto 20px; background: #6750A4; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 24px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo">A</div>
            <h1 class="error">Verification Failed</h1>
            <p>Invalid or expired verification token. Please request a new verification email.</p>
            <p><a href="#" onclick="window.close()">Close this window</a></p>
          </div>
        </body>
        </html>
      `);
    }

    // Update user verification status
    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();

    // Send welcome email
    try {
      await emailService.sendWelcomeEmail(user.email, user.fullName);
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
    }

    // Return success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Email Verified - Apsara AI</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
          .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
          .success { color: #27ae60; }
          .logo { width: 60px; height: 60px; margin: 0 auto 20px; background: #6750A4; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 24px; }
          .button { display: inline-block; background: #6750A4; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">A</div>
          <h1 class="success">✅ Email Verified Successfully!</h1>
          <p>Welcome to Apsara AI, <strong>${user.fullName}</strong>!</p>
          <p>Your email <strong>${user.email}</strong> has been verified. You can now log in to your account.</p>
          <a href="#" class="button" onclick="window.close()">Close Window</a>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Verification Error - Apsara AI</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
          .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); text-align: center; max-width: 500px; }
          .error { color: #e74c3c; }
          .logo { width: 60px; height: 60px; margin: 0 auto 20px; background: #6750A4; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 24px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">A</div>
          <h1 class="error">Server Error</h1>
          <p>Something went wrong during verification. Please try again later.</p>
          <p><a href="#" onclick="window.close()">Close this window</a></p>
        </div>
      </body>
      </html>
    `);
  }
});

// Verify email via POST (for app API calls)
router.post('/verify-email', async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    // Verify the OTP and update user
    const user = await User.verifyEmailOTP(email, otp);
    
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Send welcome email
    try {
      await emailService.sendWelcomeEmail(user.email, user.fullName);
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
    }

    // Generate JWT token for automatic login after verification
    const token = jwt.sign(
      { 
        id: user._id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET || 'default-secret-key',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      success: true,
      message: 'Email verified successfully!',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          isEmailVerified: user.isEmailVerified,
          role: user.role,
          subscriptionPlan: user.subscriptionPlan
        },
        token: token
      }
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during email verification'
    });
    }
  });

// Resend verification OTP
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.isEmailVerified) {
    return res.status(400).json({
        success: false,
        message: 'Email is already verified'
      });
    }

    // Generate new OTP
    const newOTP = user.generateEmailVerificationOTP();
    await user.save();

    // Send new OTP email
    const emailResult = await emailService.sendVerificationOTP(
      user.email,
      user.fullName,
      newOTP
    );

    if (!emailResult.success) {
      console.error('Failed to resend verification OTP:', emailResult.error);
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification OTP'
      });
    }

    res.json({
      success: true,
      message: 'New verification OTP sent successfully!',
      data: {
        email: user.email,
        otpSent: emailResult.success
      }
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during OTP resend'
    });
  }
});

// Forgot password (with rate limiting)
router.post('/forgot-password', authRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found with this email address'
    });
  }

    // Generate password reset OTP
    const resetOTP = user.generatePasswordResetOTP();
    await user.save();

    // Send reset OTP email
    const emailResult = await emailService.sendPasswordResetOTP(
      user.email,
      user.fullName,
      resetOTP
    );

    if (!emailResult.success) {
      console.error('Failed to send password reset OTP:', emailResult.error);
      return res.status(500).json({
        success: false,
        message: 'Failed to send password reset OTP'
      });
    }

  res.json({
    success: true,
      message: 'Password reset OTP sent to your email address!',
      data: {
        email: user.email,
        otpSent: emailResult.success
      }
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
  });
  }
});

// Verify password reset OTP (with rate limiting)
router.post('/verify-reset-otp', authRateLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    // Find user and verify OTP
    const user = await User.findOne({ 
      email: email.toLowerCase(),
      passwordResetToken: otp,
      passwordResetExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    res.json({
      success: true,
      message: 'OTP verified successfully! You can now set a new password.',
      data: {
        email: user.email,
        otpVerified: true
      }
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Verify password reset OTP and set new password (with rate limiting)
router.post('/reset-password-otp', authRateLimiter, async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    
    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, OTP, and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Verify OTP
    const user = await User.verifyPasswordResetOTP(email, otp);
    
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Update password
    user.password = newPassword;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    user.loginAttempts = 0;
    user.lockUntil = null;
    
    await user.save();

    res.json({
      success: true,
      message: 'Password updated successfully! You can now login with your new password.',
      data: {
        email: user.email
      }
    });

  } catch (error) {
    console.error('Password reset error:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Internal server error';
    
    if (error.name === 'ValidationError') {
      errorMessage = 'Password validation failed';
    } else if (error.name === 'MongoError' || error.name === 'MongooseError') {
      errorMessage = 'Database error occurred';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Reset password (with rate limiting)
router.post('/reset-password', authRateLimiter, async (req, res) => {
  try {
    // Validate request body
    const { error, value } = resetPasswordSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
        success: false,
        message: 'Validation error',
        details: error.details[0].message
      });
    }

    const { token, password } = value;

    // Verify token and find user
    const user = await User.verifyPasswordResetToken(token);
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Update password
    user.password = password;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get all users (for admin/testing purposes)
router.get('/', async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const users = await User
      .find({})
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .select('id fullName email isEmailVerified role createdAt usage.lastLogin');

    const total = await User.countDocuments({});

    res.json({
      success: true,
      data: users,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get current user profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
  res.json({
    success: true,
      data: {
        user: req.user
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update user profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { fullName, preferences, profilePicture } = req.body;
    const user = req.user;

    if (fullName) {
      user.fullName = fullName;
    }

    if (preferences) {
      user.preferences = { ...user.preferences, ...preferences };
    }

    if (profilePicture !== undefined) {
      user.profilePicture = profilePicture;
    }

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          profilePicture: user.profilePicture,
          subscriptionPlan: user.subscriptionPlan,
          authProvider: user.authProvider,
          hasPassword: user.password && user.password.startsWith('$2')
        }
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Set password for Google-only accounts
router.post('/set-password', authMiddleware, async (req, res) => {
  try {
    const { password, confirmPassword } = req.body;
    const user = await User.findById(req.user._id).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Validate password
    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    // Check if user already has a valid password (not a random UUID from Google signup)
    const hasValidPassword = user.password && user.password.startsWith('$2');
    if (hasValidPassword && user.authProvider === 'local') {
      return res.status(400).json({
        success: false,
        message: 'You already have a password set. Use "Change Password" instead.'
      });
    }

    // Set new password
    user.password = password; // Will be hashed by pre-save hook
    user.authProvider = user.authProvider === 'google' ? 'google' : 'local'; // Keep google if it was google
    await user.save();

    res.json({
      success: true,
      message: 'Password set successfully! You can now log in with email and password.',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          profilePicture: user.profilePicture,
          subscriptionPlan: user.subscriptionPlan,
          authProvider: user.authProvider,
          hasPassword: true
        }
      }
    });

  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while setting password'
    });
  }
});

// Get current user profile
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const hasPassword = user.password && user.password.startsWith('$2');

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          profilePicture: user.profilePicture,
          subscriptionPlan: user.subscriptionPlan,
          authProvider: user.authProvider || 'local',
          hasPassword: hasPassword,
          isEmailVerified: user.isEmailVerified,
          createdAt: user.createdAt
        }
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Upgrade user subscription (placeholder for payment gateway)
router.put('/:userId/subscription', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const { subscriptionPlan } = req.body;

    // Validate user access (users can only update their own subscription or admin can update any)
    if (req.user._id.toString() !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update your own subscription.'
      });
    }

    // Validate subscription plan
    const validPlans = ['free', 'pro', 'premium', 'enterprise'];
    if (!validPlans.includes(subscriptionPlan)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription plan. Valid plans: ' + validPlans.join(', ')
      });
    }

    // Find and update user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update subscription plan
    const previousPlan = user.subscriptionPlan;
    user.subscriptionPlan = subscriptionPlan;
    await user.save();

    // Update usage tracking for new plan
    await UserUsage.findOrCreateUsage(userId, subscriptionPlan);

    // Clear any existing rate limit state when upgrading to premium/enterprise
    if (subscriptionPlan === 'premium' || subscriptionPlan === 'enterprise') {
      await clearUserRateLimit(userId);
    }

    console.log(`📈 User subscription upgraded: ${user.email} from ${previousPlan} to ${subscriptionPlan}`);

    res.json({
      success: true,
      message: `Subscription successfully upgraded to ${subscriptionPlan}`,
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          subscriptionPlan: user.subscriptionPlan,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          avatarUrl: user.profilePicture || null
        }
      }
    });

  } catch (error) {
    console.error('Subscription upgrade error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during subscription upgrade'
    });
  }
});

// Delete user account (with all conversations and messages)
router.delete('/account', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const user = req.user;

    console.log(`🗑️ Deleting user account: ${user.fullName} (${user.email})`);

    // Get count of conversations and messages for logging
    const conversationCount = await Conversation.countDocuments({ userId });
    const messageCount = await Message.countDocuments({ userId });

    console.log(`📊 Found ${conversationCount} conversations and ${messageCount} messages to delete`);

    // Delete all user data in parallel for better performance
    await Promise.all([
      Conversation.deleteMany({ userId }),
      Message.deleteMany({ userId }),
      UserUsage.deleteMany({ userId }),
      User.deleteOne({ _id: user._id })
    ]);

    console.log(`✅ User account deleted successfully: ${user.email}`);
    console.log(`📊 Deleted: User + ${conversationCount} conversations + ${messageCount} messages`);

    res.json({
      success: true,
      message: 'Account deleted successfully',
      data: {
        deletedConversations: conversationCount,
        deletedMessages: messageCount
      }
    });

  } catch (error) {
    console.error('❌ Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account',
      error: error.message
    });
  }
});

// Test email connection
router.get('/test-email', async (req, res) => {
  try {
    const result = await emailService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
  });
  }
});

export default router; 