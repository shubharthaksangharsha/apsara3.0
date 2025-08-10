import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { File } from '../models/index.js';

/**
 * Audio Storage Service
 * Handles audio file storage for Live API with support for local and S3 storage
 */
export class AudioStorageService {
  constructor() {
    this.localStorage = {
      audioPath: './uploads/audio/',
      ensure: true
    };
    
    // S3 storage placeholder - to be implemented
    this.s3Storage = {
      bucket: process.env.AUDIO_S3_BUCKET || 'apsara-audio-storage',
      region: process.env.AWS_REGION || 'us-east-1',
      implemented: false // TODO: Implement S3 audio storage
    };
    
    this.defaultStorage = process.env.AUDIO_STORAGE_METHOD || 'local';
  }

  /**
   * Initialize audio storage directories
   */
  async initialize() {
    try {
      if (this.localStorage.ensure) {
        await fs.mkdir(this.localStorage.audioPath, { recursive: true });
        console.log(`📁 Audio storage directory ensured: ${this.localStorage.audioPath}`);
      }
    } catch (error) {
      console.error('Error initializing audio storage:', error);
      throw error;
    }
  }

  /**
   * Save audio data from Live API
   * @param {Buffer} audioBuffer - Audio data buffer
   * @param {Object} metadata - Audio metadata
   * @param {string} userId - User ID
   * @param {string} conversationId - Conversation ID
   * @param {string} sessionId - Live session ID
   * @returns {Promise<Object>} Saved audio file information
   */
  async saveAudioFromLive(audioBuffer, metadata, userId, conversationId, sessionId) {
    try {
      const storageMethod = this.determineStorageMethod(metadata);
      
      console.log(`🎵 Saving Live API audio using ${storageMethod} storage`);
      
      if (storageMethod === 'local') {
        return await this.saveToLocal(audioBuffer, metadata, userId, conversationId, sessionId);
      } else if (storageMethod === 's3') {
        return await this.saveToS3(audioBuffer, metadata, userId, conversationId, sessionId);
      } else {
        throw new Error(`Unsupported audio storage method: ${storageMethod}`);
      }
      
    } catch (error) {
      console.error('Error saving Live API audio:', error);
      throw error;
    }
  }

  /**
   * Save audio to local storage
   * @param {Buffer} audioBuffer - Audio data buffer
   * @param {Object} metadata - Audio metadata
   * @param {string} userId - User ID
   * @param {string} conversationId - Conversation ID
   * @param {string} sessionId - Live session ID
   * @returns {Promise<Object>} Saved file information
   */
  async saveToLocal(audioBuffer, metadata, userId, conversationId, sessionId) {
    try {
      const timestamp = Date.now();
      const fileId = `audio_${timestamp}_${uuidv4().replace(/-/g, '').substring(0, 8)}`;
      const extension = this.getFileExtension(metadata.mimeType || 'audio/wav');
      const fileName = `${fileId}.${extension}`;
      const filePath = path.join(this.localStorage.audioPath, fileName);

      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Write audio buffer to file
      await fs.writeFile(filePath, audioBuffer);

      // Create file document in database
      const fileDocument = new File({
        fileId,
        userId,
        conversationId,
        originalName: `live_audio_${timestamp}.${extension}`,
        displayName: `Live Audio - ${new Date().toLocaleString()}`,
        mimeType: metadata.mimeType || 'audio/wav',
        size: audioBuffer.length,
        type: 'audio',
        storage: {
          provider: 'local',
          path: filePath,
          url: `/api/files/${fileId}/download`
        },
        metadata: {
          source: 'live-api',
          sessionId,
          duration: metadata.duration || null,
          channels: metadata.channels || null,
          sampleRate: metadata.sampleRate || null,
          bitRate: metadata.bitRate || null
        },
        createdAt: new Date(),
        expiresAt: null // Audio files don't expire in local storage
      });

      await fileDocument.save();

      console.log(`✅ Live API audio saved to local storage: ${fileId} (${(audioBuffer.length / 1024).toFixed(2)}KB)`);

      return {
        fileId,
        url: `/api/files/${fileId}/download`,
        size: audioBuffer.length,
        mimeType: metadata.mimeType || 'audio/wav',
        duration: metadata.duration || null,
        storage: 'local',
        filePath,
        metadata: {
          source: 'live-api',
          sessionId,
          savedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('Error saving audio to local storage:', error);
      throw error;
    }
  }

  /**
   * Save audio to S3 storage (PLACEHOLDER)
   * @param {Buffer} audioBuffer - Audio data buffer
   * @param {Object} metadata - Audio metadata
   * @param {string} userId - User ID
   * @param {string} conversationId - Conversation ID
   * @param {string} sessionId - Live session ID
   * @returns {Promise<Object>} Saved file information
   */
  async saveToS3(audioBuffer, metadata, userId, conversationId, sessionId) {
    // TODO: Implement S3 audio storage
    throw new Error('S3 audio storage not yet implemented. Use local storage for now.');
    
    /*
    // Future S3 implementation:
    try {
      const timestamp = Date.now();
      const fileId = `audio_${timestamp}_${uuidv4().replace(/-/g, '').substring(0, 8)}`;
      const extension = this.getFileExtension(metadata.mimeType || 'audio/wav');
      const s3Key = `audio/${userId}/${conversationId}/${fileId}.${extension}`;

      // AWS S3 upload logic here
      const s3Upload = await this.s3Client.upload({
        Bucket: this.s3Storage.bucket,
        Key: s3Key,
        Body: audioBuffer,
        ContentType: metadata.mimeType || 'audio/wav',
        Metadata: {
          userId,
          conversationId,
          sessionId,
          source: 'live-api'
        }
      }).promise();

      // Create file document in database
      const fileDocument = new File({
        fileId,
        userId,
        conversationId,
        originalName: `live_audio_${timestamp}.${extension}`,
        displayName: `Live Audio - ${new Date().toLocaleString()}`,
        mimeType: metadata.mimeType || 'audio/wav',
        size: audioBuffer.length,
        type: 'audio',
        storage: {
          provider: 's3',
          bucket: this.s3Storage.bucket,
          key: s3Key,
          url: s3Upload.Location
        },
        metadata: {
          source: 'live-api',
          sessionId,
          duration: metadata.duration || null
        },
        createdAt: new Date(),
        expiresAt: null
      });

      await fileDocument.save();

      return {
        fileId,
        url: s3Upload.Location,
        size: audioBuffer.length,
        mimeType: metadata.mimeType || 'audio/wav',
        duration: metadata.duration || null,
        storage: 's3',
        s3Key,
        metadata: {
          source: 'live-api',
          sessionId,
          savedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('Error saving audio to S3:', error);
      throw error;
    }
    */
  }

  /**
   * Determine storage method based on configuration and metadata
   * @param {Object} metadata - Audio metadata
   * @returns {string} Storage method ('local' or 's3')
   */
  determineStorageMethod(metadata) {
    // For now, always use local storage
    // In the future, this could be based on:
    // - File size
    // - User subscription plan
    // - Configuration settings
    
    if (this.defaultStorage === 's3' && this.s3Storage.implemented) {
      return 's3';
    }
    
    return 'local';
  }

  /**
   * Get file extension from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} File extension
   */
  getFileExtension(mimeType) {
    const mimeToExt = {
      'audio/wav': 'wav',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/ogg': 'ogg',
      'audio/webm': 'webm',
      'audio/flac': 'flac',
      'audio/aac': 'aac'
    };
    
    return mimeToExt[mimeType] || 'wav';
  }

  /**
   * Get audio file by ID
   * @param {string} fileId - File ID
   * @param {string} userId - User ID (for security)
   * @returns {Promise<Object>} File information
   */
  async getAudioFile(fileId, userId) {
    try {
      const file = await File.findOne({ 
        fileId, 
        userId, 
        type: 'audio' 
      });

      if (!file) {
        throw new Error(`Audio file ${fileId} not found for user ${userId}`);
      }

      return {
        fileId: file.fileId,
        originalName: file.originalName,
        displayName: file.displayName,
        mimeType: file.mimeType,
        size: file.size,
        duration: file.metadata?.duration,
        url: file.storage.url,
        storage: file.storage.provider,
        createdAt: file.createdAt,
        metadata: file.metadata
      };

    } catch (error) {
      console.error('Error getting audio file:', error);
      throw error;
    }
  }

  /**
   * Delete audio file
   * @param {string} fileId - File ID
   * @param {string} userId - User ID (for security)
   * @returns {Promise<boolean>} Success status
   */
  async deleteAudioFile(fileId, userId) {
    try {
      const file = await File.findOne({ 
        fileId, 
        userId, 
        type: 'audio' 
      });

      if (!file) {
        console.log(`Audio file ${fileId} not found for deletion`);
        return false;
      }

      // Delete physical file
      if (file.storage.provider === 'local' && file.storage.path) {
        try {
          await fs.unlink(file.storage.path);
          console.log(`🗑️ Deleted local audio file: ${file.storage.path}`);
        } catch (fsError) {
          console.warn(`Warning: Could not delete local file ${file.storage.path}:`, fsError.message);
        }
      } else if (file.storage.provider === 's3') {
        // TODO: Implement S3 deletion
        console.warn('S3 audio file deletion not yet implemented');
      }

      // Delete database record
      await File.deleteOne({ fileId, userId, type: 'audio' });
      
      console.log(`✅ Audio file ${fileId} deleted successfully`);
      return true;

    } catch (error) {
      console.error('Error deleting audio file:', error);
      throw error;
    }
  }

  /**
   * List audio files for a user/conversation
   * @param {string} userId - User ID
   * @param {string} conversationId - Conversation ID (optional)
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of audio files
   */
  async listAudioFiles(userId, conversationId = null, options = {}) {
    try {
      const query = { 
        userId, 
        type: 'audio' 
      };

      if (conversationId) {
        query.conversationId = conversationId;
      }

      const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = -1 } = options;
      const skip = (page - 1) * limit;

      const files = await File.find(query)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await File.countDocuments(query);

      return {
        files: files.map(file => ({
          fileId: file.fileId,
          originalName: file.originalName,
          displayName: file.displayName,
          mimeType: file.mimeType,
          size: file.size,
          duration: file.metadata?.duration,
          url: file.storage.url,
          storage: file.storage.provider,
          createdAt: file.createdAt,
          sessionId: file.metadata?.sessionId
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };

    } catch (error) {
      console.error('Error listing audio files:', error);
      throw error;
    }
  }

  /**
   * Clean up old audio files (for maintenance)
   * @param {number} olderThanDays - Delete files older than this many days
   * @returns {Promise<number>} Number of files cleaned up
   */
  async cleanupOldAudioFiles(olderThanDays = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const oldFiles = await File.find({
        type: 'audio',
        createdAt: { $lt: cutoffDate }
      });

      let cleanedCount = 0;

      for (const file of oldFiles) {
        try {
          await this.deleteAudioFile(file.fileId, file.userId);
          cleanedCount++;
        } catch (error) {
          console.warn(`Failed to clean up audio file ${file.fileId}:`, error.message);
        }
      }

      console.log(`🧹 Cleaned up ${cleanedCount} old audio files (older than ${olderThanDays} days)`);
      return cleanedCount;

    } catch (error) {
      console.error('Error cleaning up old audio files:', error);
      throw error;
    }
  }
}

export default AudioStorageService;