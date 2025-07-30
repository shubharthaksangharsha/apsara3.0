import express from 'express';
import User from '../models/User.js';
import emailService from '../services/emailService.js';
import Joi from 'joi';
import jwt from 'jsonwebtoken';

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

// Register a new user
router.post('/register', async (req, res) => {
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

// Login user
router.post('/login', async (req, res) => {
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

// Guest login (creates/logs in test user)
router.post('/guest-login', async (req, res) => {
  try {
    let guestUser = await User.findOne({ email: 'guest@apsara.ai' });
    
    if (!guestUser) {
      // Create guest user if it doesn't exist
      guestUser = new User({
        fullName: 'Test User',
        email: 'guest@apsara.ai',
        password: 'guest123', // This will be hashed
        isEmailVerified: true,
        role: 'user',
        subscriptionPlan: 'Guest'
      });
      await guestUser.save();
    }

    // Generate auth token
    const token = guestUser.generateAuthToken();

  res.json({
    success: true,
      message: 'Guest login successful',
      data: {
        user: {
          id: guestUser._id,
          fullName: guestUser.fullName,
          email: guestUser.email,
          isEmailVerified: guestUser.isEmailVerified,
          role: guestUser.role,
          preferences: guestUser.preferences,
          usage: guestUser.usage
        },
        token,
        isGuest: true
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

  res.json({
    success: true,
      message: 'Email verified successfully!',
      data: {
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          isEmailVerified: user.isEmailVerified,
          role: user.role
        }
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

// Forgot password
router.post('/forgot-password', async (req, res) => {
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

// Verify password reset OTP and set new password
router.post('/reset-password-otp', async (req, res) => {
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
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
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
    const { fullName, preferences } = req.body;
    const user = req.user;

    if (fullName) {
      user.fullName = fullName;
    }

    if (preferences) {
      user.preferences = { ...user.preferences, ...preferences };
    }

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user
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