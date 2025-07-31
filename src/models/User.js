import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    minlength: [2, 'Full name must be at least 2 characters'],
    maxlength: [50, 'Full name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
      'Please provide a valid email address'
    ]
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false // Don't return password in queries by default
  },
  profilePicture: {
    type: String,
    default: null
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationOTP: {
    type: String,
    default: null
  },
  emailVerificationExpires: {
    type: Date,
    default: null
  },
  passwordResetToken: {
    type: String,
    default: null
  },
  passwordResetExpires: {
    type: Date,
    default: null
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'guest'],
    default: 'user'
  },
  subscriptionPlan: { 
    type: String, 
    enum: ['guest', 'free', 'premium', 'enterprise'], 
    default: 'free' 
  },
  // OAuth and authentication provider fields
  googleId: {
    type: String,
    default: null,
    sparse: true // Allows multiple null values
  },
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local'
  },
  // Guest user fields
  isGuest: {
    type: Boolean,
    default: false
  },
  guestSessionId: {
    type: String,
    default: null,
    sparse: true
  },
  preferences: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'auto'
    },
    language: {
      type: String,
      default: 'en'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      }
    }
  },
  usage: {
    totalRequests: {
      type: Number,
      default: 0
    },
    lastLogin: {
      type: Date,
      default: null
    },
    createdRequests: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes (email index is created automatically by unique: true)
userSchema.index({ emailVerificationOTP: 1 });
userSchema.index({ passwordResetToken: 1 });

// Virtual for account locked status
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();

  // Hash the password with cost of 12
  const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
  this.password = await bcrypt.hash(this.password, saltRounds);
  
  next();
});

// Instance method to check password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Instance method to generate JWT token
userSchema.methods.generateAuthToken = function() {
  const payload = {
    id: this._id,
    email: this.email,
    role: this.role,
    isEmailVerified: this.isEmailVerified
  };

  return jwt.sign(
    payload,
    process.env.JWT_SECRET || 'default-secret-key',
    { 
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      issuer: 'apsara-ai'
    }
  );
};

// Instance method to generate email verification OTP
userSchema.methods.generateEmailVerificationOTP = function() {
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  this.emailVerificationOTP = otp;
  
  // OTP expires in 10 minutes
  this.emailVerificationExpires = Date.now() + 10 * 60 * 1000;
  
  return otp;
};

// Instance method to generate password reset token
userSchema.methods.generatePasswordResetToken = function() {
  const token = crypto.randomBytes(32).toString('hex');
  
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
  
  // Token expires in 1 hour
  this.passwordResetExpires = Date.now() + 60 * 60 * 1000;
  
  return token;
};

// Instance method to generate password reset OTP
userSchema.methods.generatePasswordResetOTP = function() {
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  this.passwordResetToken = otp;
  
  // OTP expires in 15 minutes
  this.passwordResetExpires = Date.now() + 15 * 60 * 1000;
  
  return otp;
};

// Static method to verify email verification OTP
userSchema.statics.verifyEmailOTP = function(email, otp) {
  return this.findOneAndUpdate(
    {
      email: email.toLowerCase(),
      emailVerificationOTP: otp,
      emailVerificationExpires: { $gt: Date.now() }
    },
    {
      $set: {
        isEmailVerified: true,
        emailVerificationOTP: null,
        emailVerificationExpires: null
      }
    },
    { new: true }
  );
};

// Static method to verify password reset token
userSchema.statics.verifyPasswordResetToken = function(token) {
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  return this.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() }
  });
};

// Static method to verify password reset OTP
userSchema.statics.verifyPasswordResetOTP = function(email, otp) {
  return this.findOne({
    email: email.toLowerCase(),
    passwordResetToken: otp,
    passwordResetExpires: { $gt: Date.now() }
  });
};

// Instance method to handle failed login attempts
userSchema.methods.handleFailedLogin = async function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 }
    });
  }
  
  const updates = { $inc: { loginAttempts: 1 } };
  
  // If we have hit max attempts and it's not locked already, lock the account
  const maxAttempts = 5;
  const lockTime = 2 * 60 * 60 * 1000; // 2 hours
  
  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + lockTime };
  }
  
  return this.updateOne(updates);
};

// Instance method to handle successful login
userSchema.methods.handleSuccessfulLogin = async function() {
  // If we have a lock or login attempts, remove them
  const updates = {
    $unset: { lockUntil: 1, loginAttempts: 1 },
    $set: { 'usage.lastLogin': new Date() }
  };
  
  return this.updateOne(updates);
};

// Remove sensitive data when converting to JSON
userSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  
  delete userObject.password;
  delete userObject.emailVerificationToken;
  delete userObject.emailVerificationExpires;
  delete userObject.passwordResetToken;
  delete userObject.passwordResetExpires;
  delete userObject.loginAttempts;
  delete userObject.lockUntil;
  
  return userObject;
};

const User = mongoose.model('User', userSchema);

export default User; 