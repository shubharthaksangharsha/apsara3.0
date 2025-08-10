import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema({
  fileId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  conversationId: {
    type: String,
    required: false
  },
  originalName: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    enum: ['image', 'audio', 'video', 'document', 'screen', 'other'],
    required: true
  },
  storage: {
    provider: {
      type: String,
      enum: ['local', 's3', 'google-file-api'],
      default: 'local'
    },
    path: {
      type: String,
      required: true
    },
    bucket: {
      type: String,
      required: false
    },
    url: {
      type: String,
      required: false
    },
    expiresAt: {
      type: Date,
      required: false
    }
  },
  metadata: {
    width: Number,
    height: Number,
    duration: Number,
    channels: Number,
    sampleRate: Number,
    bitrate: Number,
    format: String
  },
  aiProviderFile: {
    provider: String,
    fileUri: String,
    uploadResponse: mongoose.Schema.Types.Mixed
  },
  analysis: {
    description: String,
    tags: [String],
    extractedText: String,
    aiModel: String,
    confidence: Number,
    processedAt: Date
  },
  usage: {
    timesAccessed: {
      type: Number,
      default: 0
    },
    lastAccessed: {
      type: Date,
      default: Date.now
    }
  }
}, {
  timestamps: true
});

// Indexes for performance
fileSchema.index({ userId: 1, createdAt: -1 });
fileSchema.index({ conversationId: 1 });
fileSchema.index({ type: 1 });
fileSchema.index({ 'storage.expiresAt': 1 }, { expireAfterSeconds: 0 });

// Instance methods
fileSchema.methods.getAccessUrl = function() {
  if (this.storage.provider === 's3' && this.storage.url) {
    return this.storage.url;
  } else if (this.storage.provider === 'google-file-api' && this.aiProviderFile.fileUri) {
    return this.aiProviderFile.fileUri;
  } else {
    return `/api/files/${this.fileId}/download`;
  }
};

fileSchema.methods.incrementAccess = function() {
  this.usage.timesAccessed += 1;
  this.usage.lastAccessed = new Date();
  return this.save();
};

fileSchema.methods.isExpired = function() {
  return this.storage.expiresAt && this.storage.expiresAt < new Date();
};

// Static methods
fileSchema.statics.findByUser = function(userId, type = null) {
  const query = { userId };
  if (type) query.type = type;
  return this.find(query).sort({ createdAt: -1 });
};

fileSchema.statics.findByConversation = function(conversationId) {
  return this.find({ conversationId }).sort({ createdAt: 1 });
};

export default mongoose.model('File', fileSchema); 