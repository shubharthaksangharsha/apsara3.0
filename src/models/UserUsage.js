import mongoose from 'mongoose';

// Helper to convert model names to safe field names (dots cause issues in MongoDB)
const modelToFieldName = (model) => model.replace(/\./g, '_');
const fieldNameToModel = (fieldName) => fieldName.replace(/_/g, '.');

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
    enum: ['guest', 'free', 'premium', "enterprise"],
    default: 'free',
    index: true
  },
  dailyUsage: {
    date: {
      type: String,
      default: () => new Date().toISOString().split('T')[0] // YYYY-MM-DD format as string
    },
    // Gemini models (use underscores instead of dots to avoid MongoDB nested path issues)
    'gemini-2_5-flash': {
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 20 }
    },
    'gemini-2_5-pro': {
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 5 }
    },
    // Groq Llama models
    'llama-3_1-8b-instant': {
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 50 }
    },
    'llama-3_3-70b-versatile': {
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 30 }
    },
    // Groq GPT-OSS models
    'openai/gpt-oss-20b': {
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 20 }
    },
    'openai/gpt-oss-120b': {
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 10 }
    },
    // Groq Compound models
    'groq/compound': {
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 20 }
    },
    'groq/compound-mini': {
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 30 }
    },
    // Qwen model
    'qwen/qwen3-32b': {
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 20 }
    },
    // Kimi model
    'moonshotai/kimi-k2-instruct-0905': {
      count: { type: Number, default: 0 },
      limit: { type: Number, default: 15 }
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
  // Handle both string and Date types for dailyUsage.date
  const usageDate = this.dailyUsage?.date 
    ? (typeof this.dailyUsage.date === 'string' 
        ? this.dailyUsage.date 
        : new Date(this.dailyUsage.date).toISOString().split('T')[0])
    : '';
  return today !== usageDate;
});

// Static method to get rate limits by subscription plan
userUsageSchema.statics.getRateLimits = function(subscriptionPlan) {
  const limits = {
    guest: {
      // Gemini models
      'gemini-2.5-flash': { limit: 5, type: 'total' },
      'gemini-2.5-pro': { limit: 0, type: 'total' },
      // Groq models - limited for guests
      'llama-3.1-8b-instant': { limit: 5, type: 'total' },
      'llama-3.3-70b-versatile': { limit: 0, type: 'total' },
      'openai/gpt-oss-20b': { limit: 0, type: 'total' },
      'openai/gpt-oss-120b': { limit: 0, type: 'total' },
      'groq/compound': { limit: 0, type: 'total' },
      'groq/compound-mini': { limit: 0, type: 'total' },
      'qwen/qwen3-32b': { limit: 0, type: 'total' },
      'moonshotai/kimi-k2-instruct-0905': { limit: 0, type: 'total' }
    },
    free: {
      // Gemini models
      'gemini-2.5-flash': { limit: 20, type: 'daily' },
      'gemini-2.5-pro': { limit: 5, type: 'daily' },
      // Groq models - generous limits (Groq is fast and cheap)
      'llama-3.1-8b-instant': { limit: 50, type: 'daily' },
      'llama-3.3-70b-versatile': { limit: 30, type: 'daily' },
      'openai/gpt-oss-20b': { limit: 20, type: 'daily' },
      'openai/gpt-oss-120b': { limit: 10, type: 'daily' },
      'groq/compound': { limit: 20, type: 'daily' },
      'groq/compound-mini': { limit: 30, type: 'daily' },
      'qwen/qwen3-32b': { limit: 20, type: 'daily' },
      'moonshotai/kimi-k2-instruct-0905': { limit: 15, type: 'daily' }
    },
    premium: {
      // Gemini models
      'gemini-2.5-flash': { limit: 100, type: 'daily' },
      'gemini-2.5-pro': { limit: 50, type: 'daily' },
      // Groq models - higher limits for premium
      'llama-3.1-8b-instant': { limit: 200, type: 'daily' },
      'llama-3.3-70b-versatile': { limit: 150, type: 'daily' },
      'openai/gpt-oss-20b': { limit: 100, type: 'daily' },
      'openai/gpt-oss-120b': { limit: 75, type: 'daily' },
      'groq/compound': { limit: 100, type: 'daily' },
      'groq/compound-mini': { limit: 150, type: 'daily' },
      'qwen/qwen3-32b': { limit: 100, type: 'daily' },
      'moonshotai/kimi-k2-instruct-0905': { limit: 75, type: 'daily' }
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
  
  // Convert model name to safe field name (dots -> underscores)
  const safeFieldName = modelToFieldName(model);

  if (!modelLimits) {
    return { allowed: false, reason: 'Model not available for your plan' };
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
    // For other plans, check daily limits using safe field name
    const currentUsage = this.dailyUsage[safeFieldName]?.count || 0;
    const limit = this.dailyUsage[safeFieldName]?.limit || modelLimits.limit;

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
userUsageSchema.methods.recordUsage = async function(model = 'gemini-2.5-flash', tokenCount = 0) {
  // Convert model name to safe field name (dots -> underscores)
  const safeFieldName = modelToFieldName(model);
  
  console.log(`📊 Recording usage for model: ${model} (field: ${safeFieldName}), tokens: ${tokenCount}`);
  console.log(`📊 Current dailyUsage.date: ${this.dailyUsage?.date}, needsDailyReset: ${this.needsDailyReset}`);
  
  // Reset daily usage if needed
  if (this.needsDailyReset) {
    console.log('📊 Resetting daily usage...');
    this.resetDailyUsage();
  }

  // Record usage based on subscription type
  if (this.subscriptionPlan === 'guest') {
    this.guestLimits.totalMessagesUsed += 1;
    this.markModified('guestLimits');
    console.log(`📊 Guest usage updated: ${this.guestLimits.totalMessagesUsed}`);
  } else {
    // Ensure the model key exists in dailyUsage using safe field name
    if (!this.dailyUsage[safeFieldName]) {
      console.log(`📊 Creating dailyUsage entry for model: ${safeFieldName}`);
      this.dailyUsage[safeFieldName] = { count: 0, limit: 20 };
    }
    this.dailyUsage[safeFieldName].count += 1;
    console.log(`📊 Model ${safeFieldName} usage updated: ${this.dailyUsage[safeFieldName].count}`);
    
    // Mark the dailyUsage as modified so Mongoose saves it
    this.markModified('dailyUsage');
  }

  // Update total usage
  this.totalUsage.totalMessages += 1;
  this.totalUsage.totalTokens += tokenCount;
  this.markModified('totalUsage');

  console.log(`📊 Total messages: ${this.totalUsage.totalMessages}, Total tokens: ${this.totalUsage.totalTokens}`);
  
  // Save and verify
  const savedDoc = await this.save();
  console.log(`📊 Saved! Verifying - Model ${safeFieldName} count in DB: ${savedDoc.dailyUsage[safeFieldName]?.count}`);
  return savedDoc;
};

// Instance method to reset daily usage
userUsageSchema.methods.resetDailyUsage = function() {
  const today = new Date().toISOString().split('T')[0];
  const limits = this.constructor.getRateLimits(this.subscriptionPlan);

  // Use safe field names (underscores instead of dots)
  const flashField = 'gemini-2_5-flash';
  const proField = 'gemini-2_5-pro';

  // Store previous usage in history
  this.resetHistory.push({
    resetDate: new Date(),
    resetType: 'daily',
    previousUsage: {
      date: this.dailyUsage.date,
      usage: {
        'gemini-2.5-flash': this.dailyUsage[flashField]?.count || 0,
        'gemini-2.5-pro': this.dailyUsage[proField]?.count || 0
      }
    }
  });

  // Reset daily counters - Initialize objects if they don't exist
  this.dailyUsage.date = today;
  
  // Ensure the model objects exist before setting count
  if (!this.dailyUsage[flashField]) {
    this.dailyUsage[flashField] = { count: 0, limit: 20 };
  }
  if (!this.dailyUsage[proField]) {
    this.dailyUsage[proField] = { count: 0, limit: 5 };
  }
  
  this.dailyUsage[flashField].count = 0;
  this.dailyUsage[proField].count = 0;

  // Update limits based on current subscription
  this.dailyUsage[flashField].limit = limits['gemini-2.5-flash']?.limit || 20;
  this.dailyUsage[proField].limit = limits['gemini-2.5-pro']?.limit || 5;

  this.lastResetDate = new Date();

  // Keep only last 30 days of reset history
  if (this.resetHistory.length > 30) {
    this.resetHistory = this.resetHistory.slice(-30);
  }
  
  // Mark as modified
  this.markModified('dailyUsage');
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
        'gemini-2_5-flash': {
          count: 0,
          limit: limits['gemini-2.5-flash']?.limit || 20
        },
        'gemini-2_5-pro': {
          count: 0,
          limit: limits['gemini-2.5-pro']?.limit || 5
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
      'gemini-2.5-pro': usage.canMakeRequest('gemini-2.5-pro')
    },
    lastResetDate: usage.lastResetDate,
    needsDailyReset: usage.needsDailyReset
  };
};

export default mongoose.model('UserUsage', userUsageSchema); 