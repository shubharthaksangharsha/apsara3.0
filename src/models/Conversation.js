import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  conversationId: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  title: {
    type: String,
    default: 'New Conversation'
  },
  type: {
    type: String,
    enum: ['rest', 'live', 'hybrid'],
    default: 'rest'
  },
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'archived'],
    default: 'active'
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  pinnedAt: {
    type: Date,
    default: null
  },
  
  // Configuration for the conversation
  config: {
    // REST API config
    rest: {
      systemInstruction: String,
      temperature: {
        type: Number,
        default: 0.7,
        min: 0,
        max: 2
      },
      maxOutputTokens: {
        type: Number,
        default: 8192,
        min: 1,
        max: 65536  // Updated to support Gemini 2.5 models
      },
      topP: Number,
      topK: Number,
      tools: [mongoose.Schema.Types.Mixed],
      cachedContent: String
    },
    
    // Live API config
    live: {
      responseModalities: [{
        type: String,
        enum: ['TEXT', 'AUDIO']
      }],
      speechConfig: {
        voiceConfig: mongoose.Schema.Types.Mixed,
        languageCode: String
      },
      tools: [mongoose.Schema.Types.Mixed],
      sessionResumption: mongoose.Schema.Types.Mixed,
      contextWindowCompression: mongoose.Schema.Types.Mixed,
      inputAudioTranscription: mongoose.Schema.Types.Mixed,
      outputAudioTranscription: mongoose.Schema.Types.Mixed,
      enableAffectiveDialog: Boolean,
      proactivity: mongoose.Schema.Types.Mixed
    }
  },

  // Session information
  session: {
    liveSessionId: String,
    liveSessionHandle: String,
    lastResumeHandle: String,
    isLiveActive: {
      type: Boolean,
      default: false
    },
    connectionCount: {
      type: Number,
      default: 0
    },
    lastActivity: {
      type: Date,
      default: Date.now
    }
  },

  // Statistics
  stats: {
    totalMessages: {
      type: Number,
      default: 0
    },
    messageSequence: {
      type: Number,
      default: 0
    },
    totalTokens: {
      type: Number,
      default: 0
    },
    restApiCalls: {
      type: Number,
      default: 0
    },
    liveApiInteractions: {
      type: Number,
      default: 0
    },
    filesShared: {
      type: Number,
      default: 0
    },
    duration: {
      type: Number,
      default: 0 // in milliseconds
    }
  },

  // Context for transitioning between REST and Live
  transitionContext: {
    summary: String,
    keyPoints: [String],
    lastRestMessage: mongoose.Schema.Types.Mixed,
    lastLiveMessage: mongoose.Schema.Types.Mixed,
    contextTurns: [mongoose.Schema.Types.Mixed]
  }
}, {
  timestamps: true
});

// Indexes for performance
conversationSchema.index({ userId: 1, createdAt: -1 });
conversationSchema.index({ status: 1 });
conversationSchema.index({ type: 1 });
conversationSchema.index({ 'session.isLiveActive': 1 });
conversationSchema.index({ 'session.lastActivity': -1 });

// Instance methods
conversationSchema.methods.incrementStats = function(type, tokens = 0) {
  this.stats.totalMessages += 1;
  this.stats.messageSequence += 1;
  this.stats.totalTokens += tokens;
  
  if (type === 'rest') {
    this.stats.restApiCalls += 1;
  } else if (type === 'live') {
    this.stats.liveApiInteractions += 1;
  }
  
  this.session.lastActivity = new Date();
  return this.save();
};

conversationSchema.methods.getNextMessageSequence = function() {
  this.stats.messageSequence += 1;
  return this.stats.messageSequence;
};

conversationSchema.methods.updateLiveSession = function(sessionId, handle = null) {
  this.session.liveSessionId = sessionId;
  this.session.isLiveActive = true;
  this.session.connectionCount += 1;
  
  if (handle) {
    this.session.lastResumeHandle = handle;
  }
  
  this.session.lastActivity = new Date();
  return this.save();
};

conversationSchema.methods.endLiveSession = function() {
  this.session.isLiveActive = false;
  this.session.lastActivity = new Date();
  return this.save();
};

conversationSchema.methods.pin = function() {
  this.isPinned = true;
  this.pinnedAt = new Date();
  return this.save();
};

conversationSchema.methods.unpin = function() {
  this.isPinned = false;
  this.pinnedAt = null;
  return this.save();
};

conversationSchema.methods.canTransitionToLive = function() {
  return this.type === 'rest' || this.type === 'hybrid' || this.type === 'live';
};

conversationSchema.methods.canTransitionToRest = function() {
  return this.type === 'live' || this.type === 'hybrid';
};

conversationSchema.methods.prepareTransitionContext = function(messages, summary = null) {
  this.transitionContext.contextTurns = messages.slice(-10); // Last 10 messages
  this.transitionContext.summary = summary;
  this.transitionContext.keyPoints = this.extractKeyPoints(messages);
  return this.save();
};

conversationSchema.methods.extractKeyPoints = function(messages) {
  // Simple extraction logic - can be enhanced with AI
  const keyPoints = [];
  messages.forEach(msg => {
    if (msg.role === 'user' && msg.parts && msg.parts[0] && msg.parts[0].text) {
      const text = msg.parts[0].text;
      if (text.length > 50) {
        keyPoints.push(text.substring(0, 100) + '...');
      }
    }
  });
  return keyPoints.slice(-5); // Last 5 key points
};

// Static methods
conversationSchema.statics.findActiveByUser = function(userId) {
  return this.find({ 
    userId, 
    status: { $in: ['active', 'paused'] } 
  }).sort({ updatedAt: -1 });
};

conversationSchema.statics.findActiveLiveSessions = function() {
  return this.find({ 
    'session.isLiveActive': true,
    status: 'active' 
  });
};

conversationSchema.statics.findByUserAndType = function(userId, type) {
  return this.find({ userId, type }).sort({ updatedAt: -1 });
};

export default mongoose.model('Conversation', conversationSchema); 