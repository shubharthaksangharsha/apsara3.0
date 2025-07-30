import express from 'express';
import multer from 'multer';
import Joi from 'joi';
import path from 'path';
import { promises as fs } from 'fs';
import { asyncHandler } from '../middleware/errorHandler.js';
import ProviderManager from '../providers/ProviderManager.js';

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
  provider: Joi.string().valid('google').default('google'),
  mimeType: Joi.string(),
  displayName: Joi.string(),
  description: Joi.string()
});

/**
 * @route POST /api/files/upload
 * @desc Upload files to AI provider storage
 * @access Public (with rate limiting)
 */
router.post('/upload', upload.array('files', 10), asyncHandler(async (req, res) => {
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

  const { provider } = value;
  const uploadResults = [];

  try {
    for (const file of req.files) {
      const uploadResult = await ProviderManager.uploadFile({
        provider,
        file: file.path,
        config: {
          mimeType: file.mimetype,
          displayName: value.displayName || file.originalname,
          description: value.description
        }
      });

      uploadResults.push({
        originalName: file.originalname,
        localPath: file.path,
        size: file.size,
        mimeType: file.mimetype,
        providerResponse: uploadResult
      });

      // Clean up local file after upload
      await fs.unlink(file.path).catch(() => {});
    }

    res.json({
      success: true,
      provider,
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
 * @desc List uploaded files
 * @access Public
 */
router.get('/', asyncHandler(async (req, res) => {
  const schema = Joi.object({
    provider: Joi.string().valid('google').default('google'),
    pageSize: Joi.number().min(1).max(100).default(20)
  });

  const { error, value } = schema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { provider, pageSize } = value;

  const result = await ProviderManager.listFiles({
    provider,
    pageSize
  });

  res.json(result);
}));

/**
 * @route GET /api/files/:fileId
 * @desc Get file metadata
 * @access Public
 */
router.get('/:fileId', asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  const { provider = 'google' } = req.query;

  if (!fileId) {
    return res.status(400).json({
      success: false,
      error: { message: 'File ID is required' }
    });
  }

  const result = await ProviderManager.getFile(fileId, provider);
  res.json(result);
}));

/**
 * @route DELETE /api/files/:fileId
 * @desc Delete a file
 * @access Public
 */
router.delete('/:fileId', asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  const { provider = 'google' } = req.query;

  if (!fileId) {
    return res.status(400).json({
      success: false,
      error: { message: 'File ID is required' }
    });
  }

  const result = await ProviderManager.deleteFile(fileId, provider);
  res.json(result);
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
 * @desc Get supported file types
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

  res.json({
    success: true,
    supportedTypes,
    maxFileSize: process.env.MAX_FILE_SIZE || '100MB',
    maxFilesPerRequest: 10
  });
});

export default router; 