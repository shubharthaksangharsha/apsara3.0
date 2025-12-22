import express from 'express';
import multer from 'multer';
import Joi from 'joi';
import path from 'path';
import { promises as fs } from 'fs';
import { asyncHandler } from '../middleware/errorHandler.js';
import { fileUploadRateLimiter, getFileUploadLimitInfo } from '../middleware/rateLimiter.js';
import ProviderManager from '../providers/ProviderManager.js';
import File from '../models/File.js';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const router = express.Router();

// Auth middleware for protected routes
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
    
    const tokenUserId = decoded.id || decoded.userId;
    
    const user = await User.findById(tokenUserId);
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

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    try {
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Allow specific file types
  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/ogg',
    'video/mp4', 'video/avi', 'video/mov', 'video/webm',
    'application/pdf', 'text/plain', 'text/csv',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} not supported`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024, // 100MB default
    files: 10 // Maximum 10 files per request
  }
});

// Validation schemas
const uploadConfigSchema = Joi.object({
  storageMethod: Joi.string().valid('local', 's3', 'google-file-api', 'auto').default('auto'),
  aiProvider: Joi.string().valid('google', 'anthropic', 'xai', 'openai').default('google'),
  userId: Joi.string().required(),
  conversationId: Joi.string().optional(),
  displayName: Joi.string(),
  description: Joi.string(),
  forceStorageProvider: Joi.string().valid('local', 's3', 'google-file-api') // Override for testing
});

// Smart storage decision helper
function determineOptimalStorage(files, options = {}) {
  const { forceStorageProvider, aiProvider = 'google', preference = 'processing' } = options;
  
  // If explicitly forced, use that
  if (forceStorageProvider) {
    return { method: forceStorageProvider, reason: 'Explicitly forced by user' };
  }
  
  // Thresholds (configurable via environment) - Define first
  const SMALL_FILE_THRESHOLD = parseInt(process.env.SMALL_FILE_THRESHOLD) || 5 * 1024 * 1024; // 5MB
  const LARGE_FILE_THRESHOLD = parseInt(process.env.LARGE_FILE_THRESHOLD) || 20 * 1024 * 1024; // 20MB
  const AUDIO_SIZE_THRESHOLD = parseInt(process.env.AUDIO_SIZE_THRESHOLD) || 10 * 1024 * 1024; // 10MB for audio
  const TOTAL_SIZE_THRESHOLD = parseInt(process.env.TOTAL_SIZE_THRESHOLD) || 50 * 1024 * 1024; // 50MB
  const MULTIPLE_FILES_THRESHOLD = parseInt(process.env.MULTIPLE_FILES_THRESHOLD) || 3;
  
  // Calculate total size and count
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const fileCount = files.length;
  const maxFileSize = Math.max(...files.map(f => f.size));
  
  // Check file types for optimized storage decisions
  const hasImages = files.some(file => file.mimetype.startsWith('image/'));
  const hasPdfs = files.some(file => file.mimetype === 'application/pdf');
  const hasVideos = files.some(file => file.mimetype.startsWith('video/'));
  const hasAudio = files.some(file => file.mimetype.startsWith('audio/'));
  
  // Images and PDFs prefer local storage for fast access (changed from Google API)
  if ((hasImages || hasPdfs) && !hasVideos && maxFileSize <= LARGE_FILE_THRESHOLD) {
    return {
      method: 'local',
      reason: `Image/PDF files detected (${hasImages ? 'images' : ''}${hasImages && hasPdfs ? ' and ' : ''}${hasPdfs ? 'PDFs' : ''}). Using local storage for fast access and persistence.`,
      metrics: { totalSize, fileCount, maxFileSize, hasImages, hasPdfs },
      preference: preference
    };
  }
  
  // Videos always use Google File API for processing optimization
  if (hasVideos) {
    return {
      method: 'google-file-api',
      reason: `Video files detected. Using Google File API for optimal video processing.`,
      metrics: { totalSize, fileCount, maxFileSize, hasVideos: true },
      preference: preference
    };
  }
  
  // Audio files: size-based decision
  if (hasAudio && !hasImages && !hasPdfs) {
    if (maxFileSize <= AUDIO_SIZE_THRESHOLD) {
      return {
        method: 'local',
        reason: `Small audio files detected (max: ${(maxFileSize/1024/1024).toFixed(1)}MB). Using local storage for fast access.`,
        metrics: { totalSize, fileCount, maxFileSize, hasAudio: true },
        preference: preference
      };
    } else {
      return {
        method: 'google-file-api',
        reason: `Large audio files detected (max: ${(maxFileSize/1024/1024).toFixed(1)}MB). Using Google File API for processing.`,
        metrics: { totalSize, fileCount, maxFileSize, hasAudio: true },
        preference: preference
      };
    }
  }
  
  // Preference-based decision logic
  switch (preference) {
    case 'speed':
      // Prioritize fast upload/access - prefer local storage
      if (maxFileSize <= LARGE_FILE_THRESHOLD && totalSize <= TOTAL_SIZE_THRESHOLD) {
        return {
          method: 'local',
          reason: `Speed preference: Using local storage for faster upload/access (max: ${(maxFileSize/1024/1024).toFixed(1)}MB, total: ${(totalSize/1024/1024).toFixed(1)}MB).`,
          metrics: { totalSize, fileCount, maxFileSize },
          preference: 'speed'
        };
      }
      break;
      
    case 'storage':
      // Prioritize long-term storage - prefer S3 or local
      if (maxFileSize <= LARGE_FILE_THRESHOLD) {
        return {
          method: 'local', // Would be 's3' in production
          reason: `Storage preference: Using persistent storage for long-term retention (max: ${(maxFileSize/1024/1024).toFixed(1)}MB, total: ${(totalSize/1024/1024).toFixed(1)}MB).`,
          metrics: { totalSize, fileCount, maxFileSize },
          preference: 'storage'
        };
      }
      break;
      
    case 'processing':
    default:
      // Prioritize AI processing optimization - standard logic with lower thresholds
      if (maxFileSize > LARGE_FILE_THRESHOLD || totalSize > TOTAL_SIZE_THRESHOLD) {
        return {
          method: 'google-file-api',
          reason: `Processing preference: Large files detected (max: ${(maxFileSize/1024/1024).toFixed(1)}MB, total: ${(totalSize/1024/1024).toFixed(1)}MB). Using Files API for optimal AI processing.`,
          metrics: { totalSize, fileCount, maxFileSize },
          preference: 'processing'
        };
      }
      
      if (fileCount >= MULTIPLE_FILES_THRESHOLD && totalSize > SMALL_FILE_THRESHOLD) {
        return {
          method: 'google-file-api',
          reason: `Processing preference: Multiple files (${fileCount}) with significant total size (${(totalSize/1024/1024).toFixed(1)}MB). Using Files API for batch AI processing.`,
          metrics: { totalSize, fileCount, maxFileSize },
          preference: 'processing'
        };
      }
      break;
  }
  
  // Fallback logic - handle very large files regardless of preference
  if (maxFileSize > LARGE_FILE_THRESHOLD || totalSize > TOTAL_SIZE_THRESHOLD) {
    return {
      method: 'google-file-api',
      reason: `Large files override (max: ${(maxFileSize/1024/1024).toFixed(1)}MB, total: ${(totalSize/1024/1024).toFixed(1)}MB). Using Files API regardless of preference.`,
      metrics: { totalSize, fileCount, maxFileSize },
      preference: preference
    };
  }
  
  // Default to local for small files
  return {
    method: 'local',
    reason: `Small files (max: ${(maxFileSize/1024/1024).toFixed(1)}MB, total: ${(totalSize/1024/1024).toFixed(1)}MB). Using local storage for fast access.`,
    metrics: { totalSize, fileCount, maxFileSize },
    preference: preference
  };
}

/**
 * @route GET /api/files/upload-limits
 * @desc Check file upload rate limits for the current user
 * @access Public (optional auth)
 */
router.get('/upload-limits', asyncHandler(async (req, res) => {
  // Extract userId from token if provided, otherwise treat as guest
  let userId = null;
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const jwt = await import('jsonwebtoken');
      const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId || decoded.id;
    } catch (error) {
      // Invalid token, treat as guest
      userId = null;
    }
  }
  
  const limitInfo = await getFileUploadLimitInfo(userId);
  
  res.json({
    success: true,
    data: limitInfo
  });
}));

/**
 * @route POST /api/files/upload
 * @desc Upload files using specified storage method
 * @access Public (with subscription-based rate limiting)
 */
router.post('/upload', fileUploadRateLimiter, (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) {
      // Handle multer errors
      let errorMessage = 'File upload failed';
      let errorCode = 400;
      
      if (err instanceof multer.MulterError) {
        switch (err.code) {
          case 'LIMIT_FILE_SIZE':
            const maxSizeMB = Math.round((parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024) / 1024 / 1024);
            errorMessage = `File too large. Maximum file size is ${maxSizeMB}MB`;
            break;
          case 'LIMIT_FILE_COUNT':
            errorMessage = 'Too many files. Maximum 10 files per request';
            break;
          case 'LIMIT_UNEXPECTED_FILE':
            errorMessage = 'Unexpected file field';
            break;
          default:
            errorMessage = `Upload error: ${err.message}`;
        }
      } else if (err.message.includes('File type')) {
        errorMessage = err.message;
      } else {
        errorMessage = err.message || 'Unknown upload error';
      }
      
      return res.status(errorCode).json({
        success: false,
        error: { 
          message: errorMessage,
          code: err.code || 'UPLOAD_ERROR',
          details: process.env.NODE_ENV === 'development' ? err.stack : undefined
        }
      });
    }
    next();
  });
}, asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      success: false,
      error: { message: 'No files provided' }
    });
  }

  const { error, value } = uploadConfigSchema.validate(req.body);
  if (error) {
    // Clean up uploaded files on validation error
    await Promise.all(req.files.map(file => fs.unlink(file.path).catch(() => {})));
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { storageMethod, aiProvider, userId, conversationId, displayName, description, forceStorageProvider } = value;
  const uploadResults = [];

  try {
    // Determine optimal storage method
    let finalStorageMethod = storageMethod;
    let storageDecision = null;
    
    if (storageMethod === 'auto') {
      storageDecision = determineOptimalStorage(req.files, { forceStorageProvider, aiProvider });
      finalStorageMethod = storageDecision.method;
      
      console.log(`🧠 Smart storage decision: ${finalStorageMethod}`);
      console.log(`📊 Reason: ${storageDecision.reason}`);
    }

    for (const file of req.files) {
      const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let fileRecord;

      switch (finalStorageMethod) {
        case 'local':
          // Keep file in local upload folder
          fileRecord = new File({
            fileId,
            userId,
            conversationId,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            type: getFileType(file.mimetype),
            storage: {
              provider: 'local',
              path: file.path,
              url: `/api/files/${fileId}/download`
            }
          });
          break;

        case 's3':
          // TODO: Implement S3 upload logic
          // For now, simulate S3 upload
          const s3Url = `https://your-bucket.s3.amazonaws.com/${fileId}`;
          fileRecord = new File({
            fileId,
            userId,
            conversationId,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            type: getFileType(file.mimetype),
            storage: {
              provider: 's3',
              path: fileId,
              bucket: process.env.S3_BUCKET || 'apsara-files',
              url: s3Url
            }
          });
          // Clean up local temp file after S3 upload
          await fs.unlink(file.path).catch(() => {});
          break;

        case 'google-file-api':
          // Upload to Google File API (temporary, 48h expiry)
          const uploadResult = await ProviderManager.uploadFile({
            provider: aiProvider || 'google',
            file: file.path,
            config: {
              mimeType: file.mimetype,
              displayName: displayName || file.originalname,
              description
            }
          });

          fileRecord = new File({
            fileId,
            userId,
            conversationId,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            type: getFileType(file.mimetype),
            storage: {
              provider: 'google-file-api',
              path: uploadResult.name,
              url: uploadResult.uri,
              expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 hours
            },
            aiProviderFile: {
              provider: 'google',
              fileUri: uploadResult.uri,
              uploadResponse: uploadResult
            }
          });
          // Clean up local temp file after Google upload
          await fs.unlink(file.path).catch(() => {});
          break;
      }

      await fileRecord.save();

      const resultEntry = {
        fileId: fileRecord.fileId,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        storageMethod: finalStorageMethod,
        url: fileRecord.getAccessUrl(),
        expiresAt: fileRecord.storage.expiresAt
      };
      
      // Include Google File API URI for Live API compatibility
      if (finalStorageMethod === 'google-file-api' && fileRecord.aiProviderFile?.fileUri) {
        resultEntry.uri = fileRecord.aiProviderFile.fileUri;
      }
      
      uploadResults.push(resultEntry);
    }

    const response = {
      success: true,
      storageMethod: finalStorageMethod,
      files: uploadResults
    };

    // Include decision information for transparency
    if (storageDecision) {
      response.decision = {
        requested: storageMethod,
        selected: finalStorageMethod,
        reason: storageDecision.reason,
        metrics: storageDecision.metrics
      };
    }

    res.json(response);
  } catch (error) {
    // Clean up any remaining local files
    await Promise.all(req.files.map(file => fs.unlink(file.path).catch(() => {})));
    throw error;
  }
}));

/**
 * @route POST /api/files/smart-upload
 * @desc Smart file upload with automatic provider selection
 * @access Public (with subscription-based rate limiting)
 */
router.post('/smart-upload', fileUploadRateLimiter, (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) {
      // Handle multer errors (same as original upload)
      let errorMessage = 'File upload failed';
      let errorCode = 400;
      
      if (err instanceof multer.MulterError) {
        switch (err.code) {
          case 'LIMIT_FILE_SIZE':
            const maxSizeMB = Math.round((parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024) / 1024 / 1024);
            errorMessage = `File too large. Maximum file size is ${maxSizeMB}MB`;
            break;
          case 'LIMIT_FILE_COUNT':
            errorMessage = 'Too many files. Maximum 10 files per request';
            break;
          case 'LIMIT_UNEXPECTED_FILE':
            errorMessage = 'Unexpected file field';
            break;
          default:
            errorMessage = `Upload error: ${err.message}`;
        }
      } else if (err.message.includes('File type')) {
        errorMessage = err.message;
      } else {
        errorMessage = err.message || 'Unknown upload error';
      }
      
      return res.status(errorCode).json({
        success: false,
        error: { 
          message: errorMessage,
          code: err.code || 'UPLOAD_ERROR',
          details: process.env.NODE_ENV === 'development' ? err.stack : undefined
        }
      });
    }
    next();
  });
}, asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      success: false,
      error: { message: 'No files provided' }
    });
  }

  // Simplified validation schema for smart upload
  const smartUploadSchema = Joi.object({
    userId: Joi.string().required(),
    conversationId: Joi.string().optional(),
    displayName: Joi.string(),
    description: Joi.string(),
    aiProvider: Joi.string().valid('google', 'anthropic', 'xai', 'openai').default('google'),
    preference: Joi.string().valid('speed', 'processing', 'storage').default('processing'),
    forceLocal: Joi.boolean().default(false) // For testing/debugging
  });

  const { error, value } = smartUploadSchema.validate(req.body);
  if (error) {
    // Clean up uploaded files on validation error
    await Promise.all(req.files.map(file => fs.unlink(file.path).catch(() => {})));
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { userId, conversationId, displayName, description, aiProvider, preference, forceLocal } = value;
  const uploadResults = [];

  try {
    // Enhanced smart storage decision
    const storageDecision = determineOptimalStorage(req.files, { 
      aiProvider, 
      preference,
      forceStorageProvider: forceLocal ? 'local' : null 
    });
    
    const finalStorageMethod = storageDecision.method;
    
    console.log(`🧠 Smart upload decision: ${finalStorageMethod}`);
    console.log(`📊 Reason: ${storageDecision.reason}`);
    console.log(`🎯 User preference: ${preference}`);

    for (const file of req.files) {
      const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let fileRecord;

      switch (finalStorageMethod) {
        case 'local':
          fileRecord = new File({
            fileId,
            userId,
            conversationId,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            type: getFileType(file.mimetype),
            storage: {
              provider: 'local',
              path: file.path,
              url: `/api/files/${fileId}/download`
            }
          });
          break;

        case 'google-file-api':
          const uploadResult = await ProviderManager.uploadFile({
            provider: aiProvider,
            file: file.path,
            config: {
              mimeType: file.mimetype,
              displayName: displayName || file.originalname,
              description
            }
          });

          fileRecord = new File({
            fileId,
            userId,
            conversationId,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            type: getFileType(file.mimetype),
            storage: {
              provider: 'google-file-api',
              path: uploadResult.name,
              url: uploadResult.uri,
              expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 hours
            },
            aiProviderFile: {
              provider: aiProvider,
              fileUri: uploadResult.uri,
              uploadResponse: uploadResult
            }
          });
          await fs.unlink(file.path).catch(() => {});
          break;

        case 's3':
          // TODO: Implement S3 upload
          throw new Error('S3 upload not yet implemented');
      }

      await fileRecord.save();

      const resultEntry = {
        fileId: fileRecord.fileId,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        storageMethod: finalStorageMethod,
        url: fileRecord.getAccessUrl(),
        expiresAt: fileRecord.storage.expiresAt
      };
      
      // Include Google File API URI for Live API compatibility
      if (finalStorageMethod === 'google-file-api' && fileRecord.aiProviderFile?.fileUri) {
        resultEntry.uri = fileRecord.aiProviderFile.fileUri;
      }
      
      uploadResults.push(resultEntry);
    }

    res.json({
      success: true,
      intelligentUpload: true,
      storageMethod: finalStorageMethod,
      decision: {
        reason: storageDecision.reason,
        metrics: storageDecision.metrics,
        userPreference: preference,
        aiProvider: aiProvider
      },
      files: uploadResults
    });

  } catch (error) {
    // Clean up any remaining local files
    await Promise.all(req.files.map(file => fs.unlink(file.path).catch(() => {})));
    throw error;
  }
}));

/**
 * @route GET /api/files
 * @desc List user's uploaded files
 * @access Public
 */
router.get('/', asyncHandler(async (req, res) => {
  const schema = Joi.object({
    userId: Joi.string().required(),
    storageMethod: Joi.string().valid('local', 's3', 'google-file-api'),
    type: Joi.string().valid('image', 'audio', 'video', 'document', 'other'),
    pageSize: Joi.number().min(1).max(100).default(20),
    page: Joi.number().min(1).default(1)
  });

  const { error, value } = schema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { userId, storageMethod, type, pageSize, page } = value;

  const query = { userId };
  if (storageMethod) query['storage.provider'] = storageMethod;
  if (type) query.type = type;

  const skip = (page - 1) * pageSize;
  const files = await File.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(pageSize)
    .lean();

  const total = await File.countDocuments(query);

  const filesWithUrls = files.map(file => ({
    ...file,
    url: file.storage.provider === 's3' ? file.storage.url : 
         file.storage.provider === 'google-file-api' ? file.storage.url :
         `/api/files/${file.fileId}/download`,
    isExpired: file.storage.expiresAt && file.storage.expiresAt < new Date()
  }));

  res.json({
    success: true,
    files: filesWithUrls,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  });
}));

/**
 * @route GET /api/files/:fileId
 * @desc Get file metadata
 * @access Public
 */
router.get('/:fileId', asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  const { userId } = req.query;

  if (!fileId || !userId) {
    return res.status(400).json({
      success: false,
      error: { message: 'File ID and User ID are required' }
    });
  }

  const file = await File.findOne({ fileId, userId });
  if (!file) {
    return res.status(404).json({
      success: false,
      error: { message: 'File not found' }
    });
  }

  res.json({
    success: true,
    file: {
      ...file,
      url: file.storage.provider === 's3' ? file.storage.url : 
           file.storage.provider === 'google-file-api' ? file.storage.url :
           `/api/files/${file.fileId}/download`,
      isExpired: file.storage.expiresAt && file.storage.expiresAt < new Date()
    }
  });
}));

/**
 * @route GET /api/files/:fileId/download
 * @desc Download/serve a file
 * @access Public
 */
router.get('/:fileId/download', asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  const { userId } = req.query;

  if (!fileId) {
    return res.status(400).json({
      success: false,
      error: { message: 'File ID is required' }
    });
  }

  // Find file by fileId (userId optional for public access to uploaded files)
  const file = await File.findOne({ fileId });
  if (!file) {
    return res.status(404).json({
      success: false,
      error: { message: 'File not found' }
    });
  }

  // Check if file is expired
  if (file.isExpired()) {
    return res.status(410).json({
      success: false,
      error: { message: 'File has expired' }
    });
  }

  try {
    // Handle different storage providers
    switch (file.storage.provider) {
      case 'local':
        // Serve local file
        const filePath = file.storage.path;
        
        // Check if file exists
        try {
          await fs.access(filePath, fs.constants.F_OK);
        } catch (error) {
          return res.status(404).json({
            success: false,
            error: { message: 'File not found on disk' }
          });
        }

        // Increment access count
        await file.incrementAccess();

        // Set appropriate headers
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        
        // Send file
        res.sendFile(path.resolve(filePath));
        break;

      case 'google-file-api':
        // Redirect to Google File API URL
        if (file.aiProviderFile?.fileUri) {
          await file.incrementAccess();
          res.redirect(file.aiProviderFile.fileUri);
        } else {
          res.status(404).json({
            success: false,
            error: { message: 'File URI not available' }
          });
        }
        break;

      case 's3':
        // Redirect to S3 URL
        if (file.storage.url) {
          await file.incrementAccess();
          res.redirect(file.storage.url);
        } else {
          res.status(404).json({
            success: false,
            error: { message: 'S3 URL not available' }
          });
        }
        break;

      default:
        res.status(500).json({
          success: false,
          error: { message: 'Unknown storage provider' }
        });
    }

  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to serve file' }
    });
  }
}));

/**
 * @route DELETE /api/files/:fileId
 * @desc Delete a file
 * @access Public
 */
router.delete('/:fileId', asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  const { userId } = req.query;

  if (!fileId || !userId) {
    return res.status(400).json({
      success: false,
      error: { message: 'File ID and User ID are required' }
    });
  }

  const file = await File.findOne({ fileId, userId });
  if (!file) {
    return res.status(404).json({
      success: false,
      error: { message: 'File not found' }
    });
  }

  try {
    // Delete from storage based on provider
    switch (file.storage.provider) {
      case 'local':
        await fs.unlink(file.storage.path).catch(() => {});
        break;
      case 's3':
        // TODO: Implement S3 deletion
        console.log(`TODO: Delete S3 file: ${file.storage.path}`);
        break;
      case 'google-file-api':
        if (file.aiProviderFile?.uploadResponse?.name) {
          await ProviderManager.deleteFile(file.aiProviderFile.uploadResponse.name, 'google');
        }
        break;
    }

    // Delete from database
    await File.deleteOne({ fileId, userId });

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
}));

/**
 * @route POST /api/files/:fileId/analyze
 * @desc Analyze a file using AI
 * @access Public
 */
router.post('/:fileId/analyze', asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  
  const schema = Joi.object({
    provider: Joi.string().valid('google').default('google'),
    model: Joi.string().default('gemini-2.5-flash'),
    prompt: Joi.string().default('Please analyze this file and describe what you see.'),
    config: Joi.object({
      systemInstruction: Joi.string(),
      temperature: Joi.number().min(0).max(2).default(0.7),
      maxOutputTokens: Joi.number().min(1).max(65536).default(8192)
    }).default({})
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { provider, model, prompt, config } = value;

  // Get file information
  const fileResult = await ProviderManager.getFile(fileId, provider);
  if (!fileResult.success) {
    return res.status(404).json({
      success: false,
      error: { message: 'File not found' }
    });
  }

  const file = fileResult.file;

  // Create content with file reference
  const contents = [
    {
      fileData: {
        mimeType: file.mimeType,
        fileUri: file.uri
      }
    },
    {
      text: prompt
    }
  ];

  const result = await ProviderManager.generateContent({
    provider,
    model,
    contents,
    config
  });

  res.json({
    ...result,
    fileInfo: {
      name: file.name,
      displayName: file.displayName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes
    }
  });
}));

/**
 * @route POST /api/files/analyze-local
 * @desc Analyze locally uploaded files without storing them
 * @access Public
 */
router.post('/analyze-local', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: { message: 'No file provided' }
    });
  }

  const schema = Joi.object({
    provider: Joi.string().valid('google').default('google'),
    model: Joi.string().default('gemini-2.5-flash'),
    prompt: Joi.string().default('Please analyze this file and describe what you see.'),
    config: Joi.object({
      systemInstruction: Joi.string(),
      temperature: Joi.number().min(0).max(2).default(0.7),
      maxOutputTokens: Joi.number().min(1).max(65536).default(8192)
    }).default({})
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { provider, model, prompt, config } = value;

  try {
    // Upload file temporarily
    const uploadResult = await ProviderManager.uploadFile({
      provider,
      file: req.file.path,
      config: {
        mimeType: req.file.mimetype,
        displayName: req.file.originalname
      }
    });

    // Analyze the file
    const contents = [
      {
        fileData: {
          mimeType: req.file.mimetype,
          fileUri: uploadResult.uri
        }
      },
      {
        text: prompt
      }
    ];

    const result = await ProviderManager.generateContent({
      provider,
      model,
      contents,
      config
    });

    // Clean up: delete the temporary file from provider
    await ProviderManager.deleteFile(uploadResult.name, provider).catch(() => {});

    res.json({
      ...result,
      fileInfo: {
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype
      }
    });
  } catch (error) {
    throw error;
  } finally {
    // Clean up local file
    await fs.unlink(req.file.path).catch(() => {});
  }
}));

/**
 * @route GET /api/files/supported-types
 * @desc Get supported file types and storage methods
 * @access Public
 */
router.get('/supported-types', (req, res) => {
  const supportedTypes = {
    images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    audio: ['audio/mpeg', 'audio/wav', 'audio/mp3', 'audio/ogg'],
    video: ['video/mp4', 'video/avi', 'video/mov', 'video/webm'],
    documents: [
      'application/pdf', 
      'text/plain', 
      'text/csv',
      'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  };

  const storageMethods = {
    local: {
      description: 'Store files in local upload folder',
      pros: ['Fast access', 'No external dependencies'],
      cons: ['Limited by disk space', 'Not scalable across servers'],
      bestFor: 'Small files < 5MB, single files, quick access'
    },
    s3: {
      description: 'Store files in AWS S3 bucket',
      pros: ['Scalable', 'Reliable', 'CDN integration'],
      cons: ['Requires AWS setup', 'Additional cost'],
      bestFor: 'Production environments, permanent storage'
    },
    'google-file-api': {
      description: 'Upload to Google File API (48h expiry, for AI processing)',
      pros: ['Integrated with Google AI', 'No storage cost', 'Optimized for AI'],
      cons: ['48h expiry', 'Processing only', 'Cannot download'],
      bestFor: 'Large files > 20MB, AI processing, multiple files'
    },
    auto: {
      description: 'Intelligent storage selection based on file characteristics',
      pros: ['Optimal performance', 'No manual decision needed', 'Transparent'],
      cons: ['Less control', 'Requires understanding of logic'],
      bestFor: 'Default choice, mixed file types, optimal user experience'
    }
  };

  const smartUploadThresholds = {
    smallFileThreshold: parseInt(process.env.SMALL_FILE_THRESHOLD) || 5 * 1024 * 1024, // 5MB
    largeFileThreshold: parseInt(process.env.LARGE_FILE_THRESHOLD) || 20 * 1024 * 1024, // 20MB
    totalSizeThreshold: parseInt(process.env.TOTAL_SIZE_THRESHOLD) || 50 * 1024 * 1024, // 50MB
    multipleFilesThreshold: parseInt(process.env.MULTIPLE_FILES_THRESHOLD) || 3
  };

  const uploadEndpoints = {
    manual: {
      endpoint: '/api/files/upload',
      description: 'Manual storage method selection',
      parameters: ['storageMethod', 'aiProvider', 'forceStorageProvider']
    },
    smart: {
      endpoint: '/api/files/smart-upload',
      description: 'Intelligent automatic storage selection',
      parameters: ['aiProvider', 'preference', 'forceLocal'],
      recommended: true
    }
  };

  res.json({
    success: true,
    supportedTypes,
    storageMethods,
    smartUploadThresholds,
    uploadEndpoints,
    maxFileSize: process.env.MAX_FILE_SIZE || '100MB',
    maxFilesPerRequest: 10,
    aiProviders: {
      google: { name: 'Google (Gemini)', models: ['gemini-2.5-flash', 'gemini-2.5-pro'] },
      anthropic: { name: 'Anthropic (Claude)', models: ['claude-3-sonnet', 'claude-3-opus'] },
      xai: { name: 'xAI (Grok)', models: ['grok-beta', 'grok-vision'] },
      openai: { name: 'OpenAI (GPT)', models: ['gpt-4', 'gpt-4-vision'] }
    },
    preferences: ['speed', 'processing', 'storage']
  });
});

/**
 * @route POST /api/files/file-search/upload
 * @desc Upload a file to File Search store
 * @access Authenticated
 */
router.post('/file-search/upload', fileUploadRateLimiter, (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) {
      let errorMessage = 'File upload failed';
      let errorCode = 400;
      
      if (err instanceof multer.MulterError) {
        switch (err.code) {
          case 'LIMIT_FILE_SIZE':
            const maxSizeMB = Math.round((parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024) / 1024 / 1024);
            errorMessage = `File too large. Maximum file size is ${maxSizeMB}MB`;
            break;
          case 'LIMIT_FILE_COUNT':
            errorMessage = 'Too many files. Maximum 10 files per request';
            break;
          default:
            errorMessage = `Upload error: ${err.message}`;
        }
      } else {
        errorMessage = err.message || 'Unknown upload error';
      }
      
      return res.status(errorCode).json({
        success: false,
        error: { message: errorMessage }
      });
    }
    next();
  });
}, asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({
      success: false,
      error: { message: 'No files provided' }
    });
  }

  const { userId, displayName } = req.body;
  
  if (!userId) {
    await Promise.all(req.files.map(file => fs.unlink(file.path).catch(() => {})));
    return res.status(400).json({
      success: false,
      error: { message: 'userId is required' }
    });
  }

  try {
    // Import User model
    const User = (await import('../models/User.js')).default;
    const user = await User.findOne({ _id: userId });
    
    if (!user) {
      await Promise.all(req.files.map(file => fs.unlink(file.path).catch(() => {})));
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' }
      });
    }

    // Check if user has File Search enabled
    if (!user.preferences?.useFileSearchApi) {
      await Promise.all(req.files.map(file => fs.unlink(file.path).catch(() => {})));
      return res.status(400).json({
        success: false,
        error: { message: 'File Search API is not enabled for this user' }
      });
    }

    // Create or get File Search store for user
    let fileSearchStoreName = user.preferences.fileSearchStoreName;
    
    if (!fileSearchStoreName) {
      const storeResult = await ProviderManager.createFileSearchStore({
        displayName: `${user.fullName || user.email}'s File Search Store`,
        provider: 'google'
      });
      
      fileSearchStoreName = storeResult.name;
      user.preferences.fileSearchStoreName = fileSearchStoreName;
      await user.save();
    }

    const uploadResults = [];

    for (const file of req.files) {
      // Upload file to Gemini Files API first
      const uploadResult = await ProviderManager.uploadFile({
        provider: 'google',
        file: file.path,
        config: {
          mimeType: file.mimetype,
          displayName: displayName || file.originalname
        }
      });

      // Import file into File Search store
      const importOperation = await ProviderManager.importFileToFileSearchStore({
        fileSearchStoreName,
        fileName: uploadResult.name,
        provider: 'google'
      });

      // Poll operation status (simplified - in production use webhooks or async jobs)
      let operation = importOperation.operation;
      let pollCount = 0;
      const maxPolls = 20; // Max 20 seconds
      
      if (!operation) {
        console.warn('⚠️ No operation returned from import:', importOperation);
      }
      
      while (operation && !operation?.done && pollCount < maxPolls) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
          // Pass the entire operation object to getOperation
          const opResult = await ProviderManager.getOperation({ operation: operation }, 'google');
          operation = opResult.operation;
          console.log(`📊 Operation poll ${pollCount + 1}/${maxPolls}: ${operation?.done ? 'DONE' : 'IN PROGRESS'}`);
        } catch (pollError) {
          console.error(`❌ Error polling operation status (attempt ${pollCount + 1}):`, pollError.message);
          break; // Stop polling on error
        }
        pollCount++;
      }

      // Save file record to database
      const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const fileRecord = new File({
        fileId,
        userId,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        type: getFileType(file.mimetype),
        storage: {
          provider: 'google-file-search',
          path: uploadResult.name,
          url: uploadResult.uri,
          fileSearchStoreName,
          expiresAt: null // File Search stores files indefinitely
        },
        aiProviderFile: {
          provider: 'google',
          fileUri: uploadResult.uri,
          uploadResponse: uploadResult
        }
      });

      await fileRecord.save();

      uploadResults.push({
        fileId: fileRecord.fileId,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        storageMethod: 'google-file-search',
        url: uploadResult.uri,  // Add url field for Android compatibility
        uri: uploadResult.uri,
        expiresAt: null,  // File Search stores files indefinitely
        importStatus: operation?.done ? 'completed' : (pollCount >= maxPolls ? 'timeout' : 'pending')
      });

      // Clean up local temp file
      await fs.unlink(file.path).catch(() => {});
    }

    res.json({
      success: true,
      storageMethod: 'google-file-search',
      fileSearchStoreName,
      files: uploadResults
    });
  } catch (error) {
    // Clean up any remaining local files
    await Promise.all(req.files.map(file => fs.unlink(file.path).catch(() => {})));
    throw error;
  }
}));

/**
 * @route POST /api/files/file-search/query
 * @desc Query File Search store with a question
 * @access Authenticated
 */
router.post('/file-search/query', asyncHandler(async (req, res) => {
  const { userId, query, model = 'gemini-2.5-flash' } = req.body;

  if (!userId || !query) {
    return res.status(400).json({
      success: false,
      error: { message: 'userId and query are required' }
    });
  }

  try {
    // Import User model
    const User = (await import('../models/User.js')).default;
    const user = await User.findOne({ _id: userId });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' }
      });
    }

    // Check if user has File Search enabled
    if (!user.preferences?.useFileSearchApi) {
      return res.status(400).json({
        success: false,
        error: { message: 'File Search API is not enabled for this user' }
      });
    }

    const fileSearchStoreName = user.preferences.fileSearchStoreName;
    
    if (!fileSearchStoreName) {
      return res.status(400).json({
        success: false,
        error: { message: 'No File Search store found for this user. Please upload files first.' }
      });
    }

    // Query File Search store
    const result = await ProviderManager.generateContentWithFileSearch({
      model,
      contents: query,
      fileSearchStoreNames: [fileSearchStoreName],
      config: {
        systemInstruction: user.preferences?.customSystemInstructions || undefined
      },
      provider: 'google'
    });

    res.json({
      success: true,
      text: result.text,
      citations: result.citations || [],
      model,
      usageMetadata: result.usageMetadata
    });
  } catch (error) {
    throw error;
  }
}));

/**
 * @route GET /api/files/file-search/store
 * @desc Get user's File Search store information
 * @access Authenticated
 */
router.get('/file-search/store', asyncHandler(async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: { message: 'userId is required' }
    });
  }

  try {
    // Import User model
    const User = (await import('../models/User.js')).default;
    const user = await User.findOne({ _id: userId });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' }
      });
    }

    const fileSearchStoreName = user.preferences.fileSearchStoreName;
    
    if (!fileSearchStoreName) {
      return res.json({
        success: true,
        hasStore: false,
        useFileSearchApi: user.preferences?.useFileSearchApi || false
      });
    }

    // Get store details
    const storeResult = await ProviderManager.getFileSearchStore(fileSearchStoreName, 'google');

    res.json({
      success: true,
      hasStore: true,
      useFileSearchApi: user.preferences?.useFileSearchApi || false,
      store: {
        name: storeResult.store.name,
        displayName: storeResult.store.displayName,
        createTime: storeResult.store.createTime,
        updateTime: storeResult.store.updateTime
      }
    });
  } catch (error) {
    throw error;
  }
}));

// Reset File Search store - clears the stored File Search store name
router.delete('/file-search/reset', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const previousStore = user.preferences?.fileSearchStoreName;
    
    // Clear File Search settings
    user.preferences.fileSearchStoreName = null;
    user.preferences.useFileSearchApi = false;
    await user.save();

    console.log(`🗑️ File Search store reset for user ${userId}. Previous store: ${previousStore}`);

    res.json({
      success: true,
      message: 'File Search store reset successfully',
      previousStore: previousStore
    });
  } catch (error) {
    throw error;
  }
}));

/**
 * @route GET /api/files/file-search/documents
 * @desc List all documents in user's File Search store
 * @access Authenticated
 */
router.get('/file-search/documents', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const fileSearchStoreName = user.preferences?.fileSearchStoreName;
    
    if (!fileSearchStoreName) {
      return res.json({
        success: true,
        documents: [],
        hasStore: false
      });
    }

    // List documents in the File Search store
    const documents = await ProviderManager.listFileSearchDocuments({
      fileSearchStoreName,
      provider: 'google'
    });

    res.json({
      success: true,
      documents: documents.documents || [],
      hasStore: true,
      storeName: fileSearchStoreName
    });
  } catch (error) {
    throw error;
  }
}));

/**
 * @route DELETE /api/files/file-search/documents/:documentId
 * @desc Delete a specific document from File Search store
 * @access Authenticated
 */
router.delete('/file-search/documents/:documentId', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const userId = req.user.id;
    // URL-decode the document ID since it may contain encoded slashes
    const documentId = decodeURIComponent(req.params.documentId);
    
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const fileSearchStoreName = user.preferences?.fileSearchStoreName;
    
    if (!fileSearchStoreName) {
      return res.status(404).json({
        success: false,
        error: 'No File Search store found for this user'
      });
    }

    // Delete the document from File Search store
    await ProviderManager.deleteFileSearchDocument({
      fileSearchStoreName,
      documentId,
      provider: 'google'
    });

    console.log(`🗑️ Document ${documentId} deleted from File Search store for user ${userId}`);

    res.json({
      success: true,
      message: 'Document deleted successfully'
    });
  } catch (error) {
    throw error;
  }
}));

// Helper function to determine file type
function getFileType(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.startsWith('text/')) return 'document';
  return 'other';
}

export default router;