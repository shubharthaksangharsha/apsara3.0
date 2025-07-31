import express from 'express';
import multer from 'multer';
import Joi from 'joi';
import path from 'path';
import { promises as fs } from 'fs';
import { asyncHandler } from '../middleware/errorHandler.js';
import ProviderManager from '../providers/ProviderManager.js';
import File from '../models/File.js';

const router = express.Router();

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
  storageMethod: Joi.string().valid('local', 's3', 'google-file-api').default('local'),
  userId: Joi.string().required(),
  conversationId: Joi.string().optional(),
  displayName: Joi.string(),
  description: Joi.string()
});

/**
 * @route POST /api/files/upload
 * @desc Upload files using specified storage method
 * @access Public (with rate limiting)
 */
router.post('/upload', (req, res, next) => {
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

  const { storageMethod, userId, conversationId, displayName, description } = value;
  const uploadResults = [];

  try {
    for (const file of req.files) {
      const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let fileRecord;

      switch (storageMethod) {
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
            provider: 'google',
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

      uploadResults.push({
        fileId: fileRecord.fileId,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        storageMethod,
        url: fileRecord.getAccessUrl(),
        expiresAt: fileRecord.storage.expiresAt
      });
    }

    res.json({
      success: true,
      storageMethod,
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
      maxOutputTokens: Joi.number().min(1).max(8192).default(2048)
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
      maxOutputTokens: Joi.number().min(1).max(8192).default(2048)
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
      cons: ['Limited by disk space', 'Not scalable across servers']
    },
    s3: {
      description: 'Store files in AWS S3 bucket',
      pros: ['Scalable', 'Reliable', 'CDN integration'],
      cons: ['Requires AWS setup', 'Additional cost']
    },
    'google-file-api': {
      description: 'Upload to Google File API (48h expiry, for AI processing)',
      pros: ['Integrated with Google AI', 'No storage cost'],
      cons: ['48h expiry', 'Processing only', 'Cannot download']
    }
  };

  res.json({
    success: true,
    supportedTypes,
    storageMethods,
    maxFileSize: process.env.MAX_FILE_SIZE || '100MB',
    maxFilesPerRequest: 10
  });
});

// Helper function to determine file type
function getFileType(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.startsWith('text/')) return 'document';
  return 'other';
}

export default router; 