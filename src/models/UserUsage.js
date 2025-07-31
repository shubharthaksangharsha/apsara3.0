import mongoose from 'mongoose';

const userUsageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  subscriptionPlan: {
    type: String,
    enum: ['guest', 'free', 'premium', 'enterprise'],
    default: 'free',
    index: true
  },
  dailyUsage: {
    date: {
      type: Date,
      default: () => new Date().toISOString().split('T')[0] // YYYY-MM-DD format
    },
    'gemini-2.5-flash': {
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 20 } // Free: 20/day
    },
    'gemini-2.5-pro': {
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 5 } // Free: 5/day
    },
    'gemini-2.5-flash-lite': {
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 30 } // Free: 30/day
    }
  },
  totalUsage: {
    totalMessages: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    totalConversations: { type: Number, default: 0 }
  },
  guestLimits: {
    totalMessagesLimit: { type: Number, default: 5 }, // Guest: 5 total messages
    totalMessagesUsed: { type: Number, default: 0 }
  },
  resetHistory: [{
    resetDate: { type: Date, default: Date.now },
    resetType: { type: String, enum: ['daily', 'manual', 'upgrade'] },
    previousUsage: { type: Object }
  }],
  isActive: { type: Boolean, default: true },
  lastResetDate: { type: Date, default: Date.now }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient querying
userUsageSchema.index({ userId: 1, 'dailyUsage.date': 1 });
userUsageSchema.index({ subscriptionPlan: 1, isActive: 1 });
userUsageSchema.index({ lastResetDate: 1 });

// Virtual for checking if daily reset is needed
userUsageSchema.virtual('needsDailyReset').get(function() {
  const today = new Date().toISOString().split('T')[0];
  const usageDate = new Date(this.dailyUsage.date).toISOString().split('T')[0];
  return today !== usageDate;
});

// Static method to get rate limits by subscription plan
userUsageSchema.statics.getRateLimits = function(subscriptionPlan) {
  const limits = {
    guest: {
      'gemini-2.5-flash': { limit: 5, type: 'total' }, // 5 total messages
      'gemini-2.5-pro': { limit: 0, type: 'total' }, // No access
      'gemini-2.5-flash-lite': { limit: 0, type: 'total' } // No access
    },
    free: {
      'gemini-2.5-flash': { limit: 20, type: 'daily' },
      'gemini-2.5-pro': { limit: 5, type: 'daily' },
      'gemini-2.5-flash-lite': { limit: 30, type: 'daily' }
    },
    premium: {
      'gemini-2.5-flash': { limit: 100, type: 'daily' },
      'gemini-2.5-pro': { limit: 50, type: 'daily' },
      'gemini-2.5-flash-lite': { limit: 200, type: 'daily' }
    },
    enterprise: {
      'gemini-2.5-flash': { limit: -1, type: 'unlimited' }, // Unlimited
      'gemini-2.5-pro': { limit: -1, type: 'unlimited' },
      'gemini-2.5-flash-lite': { limit: -1, type: 'unlimited' }
    }
  };
  
  return limits[subscriptionPlan] || limits.free;
};

// Instance method to check if user can make a request
userUsageSchema.methods.canMakeRequest = function(model = 'gemini-2.5-flash') {
  // Reset daily usage if needed
  if (this.needsDailyReset) {
    this.resetDailyUsage();
  }

  const limits = this.constructor.getRateLimits(this.subscriptionPlan);
  const modelLimits = limits[model];

  if (!modelLimits) {
    return { allowed: false, reason: 'Model not available for your plan' };
  }

  if (modelLimits.type === 'unlimited') {
    return { allowed: true };
  }

  if (this.subscriptionPlan === 'guest') {
    // For guests, check total message limit
    if (this.guestLimits.totalMessagesUsed >= this.guestLimits.totalMessagesLimit) {
      return { 
        allowed: false, 
        reason: `Guest limit exceeded. You have used ${this.guestLimits.totalMessagesUsed}/${this.guestLimits.totalMessagesLimit} messages.` 
      };
    }
    return { allowed: true };
  } else {
    // For other plans, check daily limits
    const currentUsage = this.dailyUsage[model]?.count || 0;
    const limit = this.dailyUsage[model]?.limit || modelLimits.limit;

    if (currentUsage >= limit) {
      return { 
        allowed: false, 
        reason: `Daily limit exceeded for ${model}. Used ${currentUsage}/${limit} messages today.` 
      };
    }
    return { allowed: true, remaining: limit - currentUsage };
  }
};

// Instance method to record usage
userUsageSchema.methods.recordUsage = function(model = 'gemini-2.5-flash', tokenCount = 0) {
  // Reset daily usage if needed
  if (this.needsDailyReset) {
    this.resetDailyUsage();
  }

  // Record usage based on subscription type
  if (this.subscriptionPlan === 'guest') {
    this.guestLimits.totalMessagesUsed += 1;
  } else {
    if (this.dailyUsage[model]) {
      this.dailyUsage[model].count += 1;
    }
  }

  // Update total usage
  this.totalUsage.totalMessages += 1;
  this.totalUsage.totalTokens += tokenCount;

  return this.save();
};

// Instance method to reset daily usage
userUsageSchema.methods.resetDailyUsage = function() {
  const today = new Date().toISOString().split('T')[0];
  const limits = this.constructor.getRateLimits(this.subscriptionPlan);

  // Store previous usage in history
  this.resetHistory.push({
    resetDate: new Date(),
    resetType: 'daily',
    previousUsage: {
      date: this.dailyUsage.date,
      usage: {
        'gemini-2.5-flash': this.dailyUsage['gemini-2.5-flash']?.count || 0,
        'gemini-2.5-pro': this.dailyUsage['gemini-2.5-pro']?.count || 0,
        'gemini-2.5-flash-lite': this.dailyUsage['gemini-2.5-flash-lite']?.count || 0
      }
    }
  });

  // Reset daily counters
  this.dailyUsage.date = today;
  this.dailyUsage['gemini-2.5-flash'].count = 0;
  this.dailyUsage['gemini-2.5-pro'].count = 0;
  this.dailyUsage['gemini-2.5-flash-lite'].count = 0;

  // Update limits based on current subscription
  this.dailyUsage['gemini-2.5-flash'].limit = limits['gemini-2.5-flash']?.limit || 20;
  this.dailyUsage['gemini-2.5-pro'].limit = limits['gemini-2.5-pro']?.limit || 5;
  this.dailyUsage['gemini-2.5-flash-lite'].limit = limits['gemini-2.5-flash-lite']?.limit || 30;

  this.lastResetDate = new Date();

  // Keep only last 30 days of reset history
  if (this.resetHistory.length > 30) {
    this.resetHistory = this.resetHistory.slice(-30);
  }
};

// Static method to find or create usage record
userUsageSchema.statics.findOrCreateUsage = async function(userId, subscriptionPlan = 'free') {
  let usage = await this.findOne({ userId });
  
  if (!usage) {
    const limits = this.getRateLimits(subscriptionPlan);
    usage = new this({
      userId,
      subscriptionPlan,
      dailyUsage: {
        date: new Date().toISOString().split('T')[0],
        'gemini-2.5-flash': {
          count: 0,
          limit: limits['gemini-2.5-flash']?.limit || 20
        },
        'gemini-2.5-pro': {
          count: 0,
          limit: limits['gemini-2.5-pro']?.limit || 5
        },
        'gemini-2.5-flash-lite': {
          count: 0,
          limit: limits['gemini-2.5-flash-lite']?.limit || 30
        }
      }
    });
    await usage.save();
  }
  
  return usage;
};

// Static method to get usage statistics
userUsageSchema.statics.getUsageStats = async function(userId) {
  const usage = await this.findOne({ userId });
  if (!usage) return null;

  return {
    subscriptionPlan: usage.subscriptionPlan,
    dailyUsage: usage.dailyUsage,
    totalUsage: usage.totalUsage,
    guestLimits: usage.guestLimits,
    canMakeRequests: {
      'gemini-2.5-flash': usage.canMakeRequest('gemini-2.5-flash'),
      'gemini-2.5-pro': usage.canMakeRequest('gemini-2.5-pro'),
      'gemini-2.5-flash-lite': usage.canMakeRequest('gemini-2.5-flash-lite')
    },
    lastResetDate: usage.lastResetDate,
    needsDailyReset: usage.needsDailyReset
  };
};

export default mongoose.model('UserUsage', userUsageSchema); 