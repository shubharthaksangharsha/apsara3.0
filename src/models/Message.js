import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  messageId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  conversationId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  
  // Message type and API
  messageType: {
    type: String,
    enum: ['rest', 'live'],
    required: true
  },
  
  role: {
    type: String,
    enum: ['user', 'model', 'system', 'tool'],
    required: true
  },
  
  // Core message content
  content: {
    // Text content
    text: String,
    
    // File references (stored in S3/Google)
    files: [{
      fileId: String,
      url: String,
      mimeType: String,
      type: {
        type: String,
        enum: ['image', 'audio', 'video', 'document', 'screen']
      },
      metadata: mongoose.Schema.Types.Mixed
    }],
    
    // Inline data (base64)
    inlineData: [{
      mimeType: String,
      data: String,
      type: String
    }],
    
    // For Live API specific content
    liveContent: {
      // Audio transcription (input/output)
      inputTranscription: {
        text: String,
        confidence: Number,
        language: String
      },
      outputTranscription: {
        text: String,
        confidence: Number,
        language: String
      },
      
      // Audio data reference
      audioData: {
        fileId: String,
        url: String,
        duration: Number,
        mimeType: String
      },
      
      // Video/Screen data reference
      videoData: {
        fileId: String,
        url: String,
        duration: Number,
        mimeType: String,
        isScreen: Boolean
      },
      
      // Real-time input metadata
      realtimeInput: {
        type: {
          type: String,
          enum: ['audio', 'video', 'image', 'screen', 'activity']
        },
        streamMetadata: mongoose.Schema.Types.Mixed
      }
    }
  },
  
  // Message context and configuration
  config: {
    // REST API config (when message was generated)
    rest: {
      model: String,
      temperature: Number,
      maxOutputTokens: Number,
      systemInstruction: String,
      tools: [mongoose.Schema.Types.Mixed]
    },
    
    // Live API config (when message was generated)
    live: {
      model: String,
      responseModalities: [String],
      speechConfig: mongoose.Schema.Types.Mixed,
      sessionConfig: mongoose.Schema.Types.Mixed
    }
  },
  
  // Tool/Function calling
  functionCall: {
    isToolCall: {
      type: Boolean,
      default: false
    },
    functionName: String,
    functionArgs: mongoose.Schema.Types.Mixed,
    functionResponse: mongoose.Schema.Types.Mixed,
    toolCallId: String,
    executionTime: Number,
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'pending'
    }
  },
  
  // Message metadata
  metadata: {
    tokens: {
      input: Number,
      output: Number,
      total: Number
    },
    timing: {
      requestTime: Date,
      responseTime: Date,
      processingDuration: Number
    },
    streaming: {
      isStreamed: Boolean,
      chunkCount: Number,
      firstChunkTime: Date,
      lastChunkTime: Date
    },
    provider: {
      name: String,
      model: String,
      apiVersion: String
    },
    clientInfo: {
      userAgent: String,
      ip: String,
      platform: String
    }
  },
  
  // Message status and flags
  status: {
    type: String,
    enum: ['pending', 'streaming', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  
  isVisible: {
    type: Boolean,
    default: true
  },
  
  isEdited: {
    type: Boolean,
    default: false
  },
  
  editHistory: [{
    editedAt: Date,
    previousContent: mongoose.Schema.Types.Mixed,
    reason: String
  }],
  
  // Error handling
  error: {
    code: String,
    message: String,
    details: mongoose.Schema.Types.Mixed,
    timestamp: Date
  }
}, {
  timestamps: true
});

// Indexes for performance
messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ userId: 1, createdAt: -1 });
messageSchema.index({ messageType: 1, role: 1 });
messageSchema.index({ status: 1 });
messageSchema.index({ 'functionCall.isToolCall': 1 });
messageSchema.index({ 'metadata.timing.requestTime': -1 });

// Instance methods
messageSchema.methods.addFile = function(fileData) {
  if (!this.content.files) {
    this.content.files = [];
  }
  this.content.files.push(fileData);
  return this.save();
};

messageSchema.methods.setFunctionCall = function(functionName, args, toolCallId) {
  this.functionCall.isToolCall = true;
  this.functionCall.functionName = functionName;
  this.functionCall.functionArgs = args;
  this.functionCall.toolCallId = toolCallId;
  this.functionCall.status = 'pending';
  return this.save();
};

messageSchema.methods.completeFunctionCall = function(response, success = true) {
  this.functionCall.functionResponse = response;
  this.functionCall.status = success ? 'completed' : 'failed';
  this.functionCall.executionTime = Date.now() - this.metadata.timing.requestTime.getTime();
  return this.save();
};

messageSchema.methods.updateTokenUsage = function(inputTokens, outputTokens) {
  this.metadata.tokens = {
    input: inputTokens,
    output: outputTokens,
    total: inputTokens + outputTokens
  };
  return this.save();
};

messageSchema.methods.startStreaming = function() {
  this.status = 'streaming';
  this.metadata.streaming.isStreamed = true;
  this.metadata.streaming.firstChunkTime = new Date();
  return this.save();
};

messageSchema.methods.completeStreaming = function(chunkCount = 0) {
  this.status = 'completed';
  this.metadata.streaming.chunkCount = chunkCount;
  this.metadata.streaming.lastChunkTime = new Date();
  this.metadata.timing.responseTime = new Date();
  this.metadata.timing.processingDuration = 
    this.metadata.timing.responseTime.getTime() - this.metadata.timing.requestTime.getTime();
  return this.save();
};

messageSchema.methods.setError = function(error) {
  this.status = 'failed';
  this.error = {
    code: error.code || 'UNKNOWN_ERROR',
    message: error.message || 'An unknown error occurred',
    details: error.details || {},
    timestamp: new Date()
  };
  return this.save();
};

// Static methods
messageSchema.statics.findByConversation = function(conversationId, limit = 50) {
  return this.find({ conversationId, isVisible: true })
    .sort({ createdAt: 1 })
    .limit(limit);
};

messageSchema.statics.findUserMessages = function(userId, messageType = null, limit = 100) {
  const query = { userId, isVisible: true };
  if (messageType) query.messageType = messageType;
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(limit);
};

messageSchema.statics.findToolCalls = function(conversationId) {
  return this.find({ 
    conversationId, 
    'functionCall.isToolCall': true,
    isVisible: true 
  }).sort({ createdAt: 1 });
};

messageSchema.statics.getTokenUsageByUser = function(userId, startDate, endDate) {
  const matchQuery = { userId };
  if (startDate || endDate) {
    matchQuery.createdAt = {};
    if (startDate) matchQuery.createdAt.$gte = startDate;
    if (endDate) matchQuery.createdAt.$lte = endDate;
  }
  
  return this.aggregate([
    { $match: matchQuery },
    { $group: {
      _id: '$userId',
      totalTokens: { $sum: '$metadata.tokens.total' },
      inputTokens: { $sum: '$metadata.tokens.input' },
      outputTokens: { $sum: '$metadata.tokens.output' },
      messageCount: { $sum: 1 },
      restMessages: { $sum: { $cond: [{ $eq: ['$messageType', 'rest'] }, 1, 0] } },
      liveMessages: { $sum: { $cond: [{ $eq: ['$messageType', 'live'] }, 1, 0] } }
    }}
  ]);
};

export default mongoose.model('Message', messageSchema); 