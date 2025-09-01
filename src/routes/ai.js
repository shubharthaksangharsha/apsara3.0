import express from 'express';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler } from '../middleware/errorHandler.js';
import ProviderManager from '../providers/ProviderManager.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import UserUsage from '../models/UserUsage.js';
import User from '../models/User.js';
import File from '../models/File.js';

const router = express.Router();

/**
 * Validate thinking budget based on model type
 * @param {string} model - Model name
 * @param {number} thinkingBudget - Thinking budget (-1, 0, or positive)
 * @returns {Object} Validation result
 */
function validateThinkingBudget(model, thinkingBudget) {
  // Dynamic thinking (-1) is always allowed
  if (thinkingBudget === -1) {
    return { valid: true };
  }

  // Model-specific ranges based on Gemini documentation
  if (model === 'gemini-2.5-pro') {
    // Pro cannot disable thinking, minimum 128
    if (thinkingBudget < 128 || thinkingBudget > 32768) {
      return {
        valid: false,
        message: 'Gemini 2.5 Pro thinking budget must be between 128-32768 tokens (cannot be disabled)'
      };
    }
  } else if (model === 'gemini-2.5-flash') {
    // Flash can be disabled (0) or 0-24576
    if (thinkingBudget < 0 || thinkingBudget > 24576) {
      return {
        valid: false,
        message: 'Gemini 2.5 Flash thinking budget must be 0 (disabled) or between 1-24576 tokens'
      };
    }
  }

  return { valid: true };
}

/**
 * Format conversation history for AI provider
 * @param {Array} messages - Array of message documents
 * @param {boolean} includeThoughts - Whether to include thinking content
 * @returns {Array} Formatted messages for AI provider
 */
function formatConversationHistory(messages, includeThoughts = false) {
  return messages.map(msg => {
    const formattedMessage = {
      role: msg.role,
      parts: [{ text: msg.content.text }]
    };

    // Include thoughts if requested and available
    if (includeThoughts && msg.content.thoughts) {
      formattedMessage.parts.push({ 
        text: `[Previous thoughts: ${msg.content.thoughts}]` 
      });
    }

    return formattedMessage;
  });
}

// Validation schemas
const generateSchema = Joi.object({
  userId: Joi.string().required(),
  conversationId: Joi.string().required(),
  contents: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.object()),
    Joi.object()
  ).required(),
  files: Joi.array().items(
    Joi.string() // File IDs or URIs
  ).default([]),
  model: Joi.string().default('gemini-2.5-flash'),
  provider: Joi.string().default('google'),
  config: Joi.object({
    temperature: Joi.number().min(0).max(2).default(0.7),
    maxOutputTokens: Joi.number().min(1).max(65536).default(2048),
    topP: Joi.number().min(0).max(1),
    topK: Joi.number().min(1).max(40),
    systemInstruction: Joi.string(),
    tools: Joi.array(),
    thinkingConfig: Joi.object({
      thinkingBudget: Joi.number().default(-1),
      includeThoughts: Joi.boolean().default(true)
    })
  }).default({}),
  stream: Joi.boolean().default(false)
});

const embeddingsSchema = Joi.object({
  contents: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.string())
  ).required(),
  model: Joi.string().default('gemini-embedding-exp-03-07'),
  provider: Joi.string().valid('google').default('google'),
  config: Joi.object({
    taskType: Joi.string().valid(
      'SEMANTIC_SIMILARITY',
      'CLASSIFICATION',
      'CLUSTERING',
      'RETRIEVAL_DOCUMENT',
      'RETRIEVAL_QUERY',
      'QUESTION_ANSWERING',
      'FACT_VERIFICATION',
      'CODE_RETRIEVAL_QUERY'
    )
  }).default({})
});

const regenerateSchema = Joi.object({
  userId: Joi.string().required(),
  conversationId: Joi.string().required(),
  messageId: Joi.string().optional(), // If not provided, regenerates last AI message
  files: Joi.array().items(
    Joi.string() // File IDs or URIs
  ).default([]),
  model: Joi.string().default('gemini-2.5-flash'),
  provider: Joi.string().default('google'),
  config: Joi.object({
    temperature: Joi.number().min(0).max(2).default(0.7),
    maxOutputTokens: Joi.number().min(1).max(65536).default(2048),
    topP: Joi.number().min(0).max(1),
    topK: Joi.number().min(1).max(40),
    systemInstruction: Joi.string(),
    tools: Joi.array(),
    thinkingConfig: Joi.object({
      thinkingBudget: Joi.number().default(-1),
      includeThoughts: Joi.boolean().default(true)
    })
  }).default({})
});

/**
 * @swagger
 * /api/ai/generate:
 *   post:
 *     summary: Generate AI content with conversation context
 *     description: Generate AI responses with full conversation history support and database storage
 *     tags: [AI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - conversationId
 *               - contents
 *             properties:
 *               userId:
 *                 type: string
 *                 description: User ID for the request
 *               conversationId:
 *                 type: string
 *                 description: Conversation ID to continue or start
 *               contents:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                   - type: object
 *                 description: Content to generate response for
 *               model:
 *                 type: string
 *                 default: gemini-2.5-flash
 *                 description: AI model to use
 *               provider:
 *                 type: string
 *                 default: google
 *                 description: AI provider to use
 *               config:
 *                 type: object
 *                 properties:
 *                   thinkingConfig:
 *                     type: object
 *                     properties:
 *                       thinkingBudget:
 *                         type: number
 *                         default: -1
 *                         description: Thinking token budget (-1 for dynamic)
 *                       includeThoughts:
 *                         type: boolean
 *                         default: true
 *                   conversationHistory:
 *                     type: object
 *                     properties:
 *                       include:
 *                         type: boolean
 *                         default: true
 *                       maxMessages:
 *                         type: number
 *                         default: 20
 *                       includeThoughts:
 *                         type: boolean
 *                         default: false
 *     responses:
 *       200:
 *         description: AI response generated successfully
 *       400:
 *         description: Invalid request parameters
 *       500:
 *         description: Server error
 */
router.post('/generate', asyncHandler(async (req, res) => {
  // Validate request
  const { error, value } = generateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  const { 
    userId, 
    conversationId, 
    contents, 
    files,
    model, 
    provider, 
    config, 
    stream 
  } = value;

  try {
    // Verify conversation exists
    const conversation = await Conversation.findOne({ conversationId, userId });
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
        details: 'Please create a conversation first'
      });
    }

    // Get user and check subscription plan
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check rate limits
    const userUsage = await UserUsage.findOrCreateUsage(userId, user.subscriptionPlan);
    const rateLimitCheck = userUsage.canMakeRequest(model);
    
    if (!rateLimitCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        details: rateLimitCheck.reason,
        usageInfo: {
          subscriptionPlan: user.subscriptionPlan,
          dailyUsage: userUsage.dailyUsage,
          guestLimits: userUsage.guestLimits,
          totalUsage: userUsage.totalUsage
        }
      });
    }

    // Validate thinking budget if specified
    if (config.thinkingConfig?.thinkingBudget !== undefined) {
      const validation = validateThinkingBudget(model, config.thinkingConfig.thinkingBudget);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid thinking budget',
          details: validation.message
        });
      }
    }

    // Always get conversation history for context
    const historyMessages = await Message.getConversationHistory(conversationId, false);
    const conversationHistory = formatConversationHistory(historyMessages, false);

    // Get next message sequence
    const messageSequence = conversation.getNextMessageSequence();
    await conversation.save();

    // Create user message with file references
    const userMessageId = uuidv4();
    
    // Prepare file references for message content
    const messageFiles = [];
    if (files && files.length > 0) {
      for (const fileIdOrUri of files) {
        try {
          // Look up file by ID to get metadata
          const file = await File.findOne({ 
            fileId: fileIdOrUri, 
            userId: userId 
          });
          
          if (file && !file.isExpired()) {
            messageFiles.push({
              fileId: file.fileId,
              originalName: file.originalName,
              mimeType: file.mimeType,
              size: file.size,
              type: file.type,
              storageProvider: file.storage.provider,
              url: file.getAccessUrl()
            });
          }
        } catch (error) {
          console.error(`Error getting file metadata for message: ${fileIdOrUri}`, error);
        }
      }
    }
    
    const userMessage = new Message({
      messageId: userMessageId,
      conversationId,
      userId,
      messageSequence,
      messageType: 'rest',
      role: 'user',
      content: {
        text: typeof contents === 'string' ? contents : JSON.stringify(contents),
        files: messageFiles // Store file references in message content
      },
      status: 'completed',
      metadata: {
        timing: {
          requestTime: new Date()
        },
        tokens: {
          input: 0, // Will be updated after AI response
          output: 0,
          total: 0
        },
        provider: {
          name: provider,
          model
        }
      }
    });

    // Save user message BEFORE sending to AI
    await userMessage.save();

    // Prepare messages for AI provider
    let messages = [];
    
    // Add conversation history if available
    if (conversationHistory.length > 0) {
      messages = [...conversationHistory];
    }

    // Process files and prepare parts for current user message
    const messageParts = [];
    
    // Add file parts first (if any)
    if (files && files.length > 0) {
      for (const fileIdOrUri of files) {
        try {
          let fileData;
          
          // Check if it's a direct URI (for google-file-api)
          if (fileIdOrUri.startsWith('gs://') || fileIdOrUri.startsWith('https://generativelanguage.googleapis.com/')) {
            // Direct Google File API URI
            fileData = {
              fileUri: fileIdOrUri
            };
          } else {
            // Look up file by ID
            const file = await File.findOne({ 
              fileId: fileIdOrUri, 
              userId: userId 
            });
            
            if (!file) {
              console.warn(`File not found: ${fileIdOrUri} for user: ${userId}`);
              continue;
            }
            
            // Check if file is expired
            if (file.isExpired()) {
              console.warn(`File expired: ${fileIdOrUri}`);
              continue;
            }
            
            // Get appropriate URI based on storage method
                          if (file.storage.provider === 'google-file-api' && file.aiProviderFile?.fileUri) {
                fileData = {
                  fileUri: file.aiProviderFile.fileUri,
                  mimeType: file.mimeType
                };
              } else if (file.storage.provider === 'local' && file.storage.path) {
                // Use inline base64 data for local files (more efficient for files <20MB)
                console.log(`📄 Processing local file as inline data for AI: ${fileIdOrUri}`);
                try {
                  const fs = await import('fs');
                  const fileBuffer = await fs.promises.readFile(file.storage.path);
                  const base64Data = fileBuffer.toString('base64');
                  
                  fileData = {
                    inlineData: {
                      mimeType: file.mimeType,
                      data: base64Data
                    }
                  };

                  console.log(`✅ Local file processed as inline data (${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
                } catch (readError) {
                  console.error(`❌ Failed to read local file: ${readError.message}`);
                  continue;
                }
              } else if (file.storage.provider === 's3' && file.storage.url) {
                // For S3, we'd need to download and upload to Google File API first for AI processing
                console.warn(`S3 files need to be downloaded and uploaded to Google File API first for AI processing: ${fileIdOrUri}`);
                console.warn(`This requires additional implementation for S3 file download and re-upload`);
                continue;
              }
          }
          
          if (fileData) {
            // Add fileData directly based on its type
            if (fileData.inlineData) {
              // For inline base64 data
              messageParts.push(fileData);
            } else if (fileData.fileUri) {
              // For Google File API URIs
              messageParts.push({
                fileData: {
                  fileUri: fileData.fileUri,
                  mimeType: fileData.mimeType
                }
              });
            }
          }
        } catch (error) {
          console.error(`Error processing file ${fileIdOrUri}:`, error);
        }
      }
    }
    
    // Add text content
    if (typeof contents === 'string') {
      messageParts.push({ text: contents });
    } else if (Array.isArray(contents)) {
      messageParts.push(...contents);
    } else {
      messageParts.push(contents);
    }
    
    // Add current user message with files and text
      messages.push({
        role: 'user',
      parts: messageParts
      });

    // Prepare generation config
    const generationConfig = {
      model,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      topP: config.topP,
      topK: config.topK,
      systemInstruction: config.systemInstruction || conversation.config?.rest?.systemInstruction
    };

    // Add thinking config if specified
    if (config.thinkingConfig) {
      generationConfig.thinkingConfig = config.thinkingConfig;
    }

    // Add tools if specified
    if (config.tools || conversation.config?.rest?.tools) {
      generationConfig.tools = config.tools || conversation.config.rest.tools;
    }

    // Generate response
    const aiResponse = await ProviderManager.generateContent({
      provider,
      contents: messages,
      config: generationConfig,
      stream
    });

    if (!aiResponse.success) {
      return res.status(500).json({
        success: false,
        error: 'AI generation failed',
        details: aiResponse.error
      });
    }

    // Create model response message ONLY if generation was successful
    const modelMessageSequence = conversation.getNextMessageSequence();
    await conversation.save();

    const modelMessage = new Message({
      messageId: uuidv4(),
      conversationId,
      userId,
      messageSequence: modelMessageSequence,
      messageType: 'rest',
      role: 'model',
      content: {
        text: aiResponse.text,
        thoughts: aiResponse.thoughts
      },
      config: {
        rest: generationConfig
      },
      status: 'completed',
      metadata: {
        timing: {
          requestTime: userMessage.metadata.timing.requestTime,
          responseTime: new Date()
        },
        tokens: {
          input: aiResponse.usageMetadata?.promptTokenCount || 0,
          output: aiResponse.usageMetadata?.candidatesTokenCount || 0,
          total: aiResponse.usageMetadata?.totalTokenCount || 0
        },
        provider: {
          name: provider,
          model,
          apiVersion: aiResponse.apiVersion
        }
      }
    });

    await modelMessage.save();

    // Update user message with token information from AI response
    userMessage.metadata.tokens = {
      input: aiResponse.usageMetadata?.promptTokenCount || 0,
      output: 0, // User messages don't generate output
      total: aiResponse.usageMetadata?.promptTokenCount || 0
    };
    await userMessage.save();

    // Record usage for rate limiting
    await userUsage.recordUsage(model, aiResponse.usageMetadata?.totalTokenCount || 0);

    // Update conversation stats
    await conversation.incrementStats('rest', aiResponse.usageMetadata?.totalTokenCount || 0);

    // Prepare enhanced response with comprehensive metadata
    const response = {
      success: true,
      provider,
      model,
      conversationId,
      userMessage: {
        messageId: userMessageId,
        messageSequence,
        content: userMessage.content.text
      },
      modelMessage: {
        messageId: modelMessage.messageId,
        messageSequence: modelMessageSequence,
        content: aiResponse.text
      },
      text: aiResponse.text,
      thoughts: aiResponse.thoughts,
      hasThoughtSignatures: aiResponse.hasThoughtSignatures || false,
      usageMetadata: {
        promptTokenCount: aiResponse.usageMetadata?.promptTokenCount || 0,
        candidatesTokenCount: aiResponse.usageMetadata?.candidatesTokenCount || 0,
        totalTokenCount: aiResponse.usageMetadata?.totalTokenCount || 0,
        thoughtsTokenCount: aiResponse.usageMetadata?.thoughtsTokenCount || 0
      },
      modelMetadata: {
        provider,
        model,
        apiVersion: aiResponse.apiVersion || '2.5',
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        topP: config.topP,
        topK: config.topK,
        systemInstruction: generationConfig.systemInstruction,
        thinkingConfig: config.thinkingConfig,
        finishReason: aiResponse.finishReason
      },
      conversationHistory: {
        included: true,
        messageCount: conversationHistory.length,
        totalHistoryMessages: historyMessages.length
      },
      conversationStats: {
        totalMessages: conversation.stats.totalMessages,
        totalTokens: conversation.stats.totalTokens,
        messageSequence: conversation.stats.messageSequence
      },
      timing: {
        requestTime: userMessage.metadata.timing.requestTime,
        responseTime: modelMessage.metadata.timing.responseTime,
        processingDuration: modelMessage.metadata.timing.responseTime - userMessage.metadata.timing.requestTime
      }
    };

    res.json(response);

  } catch (error) {
    console.error('AI Generation Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
}));

/**
 * @route POST /api/ai/embeddings
 * @desc Generate text embeddings
 * @access Public (with rate limiting)
 */
router.post('/embeddings', asyncHandler(async (req, res) => {
  const { error, value } = embeddingsSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { contents, model, provider, config } = value;

  const result = await ProviderManager.generateEmbeddings({
    contents,
    model,
    provider,
    config
  });

  res.json(result);
}));

/**
 * @route GET /api/ai/providers
 * @desc Get available providers and their capabilities
 * @access Public
 */
router.get('/providers', asyncHandler(async (req, res) => {
  const stats = ProviderManager.getStats();
  res.json({
    success: true,
    data: stats
  });
}));

/**
 * @route GET /api/ai/providers/:provider
 * @desc Get specific provider capabilities
 * @access Public
 */
router.get('/providers/:provider', asyncHandler(async (req, res) => {
  const { provider } = req.params;
  
  if (!ProviderManager.hasProvider(provider)) {
    return res.status(404).json({
      success: false,
      error: { message: `Provider '${provider}' not found` }
    });
  }

  const capabilities = ProviderManager.getProviderCapabilities(provider);
  res.json({
    success: true,
    provider,
    data: capabilities
  });
}));

/**
 * @route GET /api/ai/models
 * @desc Get all available models across all providers
 * @access Public
 */
router.get('/models', asyncHandler(async (req, res) => {
  const capabilities = ProviderManager.getAllCapabilities();
  const models = {};

  for (const [provider, caps] of Object.entries(capabilities)) {
    models[provider] = caps.models;
  }

  res.json({
    success: true,
    data: models
  });
}));

/**
 * @route GET /api/ai/models/:model
 * @desc Get provider for a specific model
 * @access Public
 */
router.get('/models/:model', asyncHandler(async (req, res) => {
  const { model } = req.params;
  const provider = ProviderManager.getProviderForModel(model);

  if (!provider) {
    return res.status(404).json({
      success: false,
      error: { message: `Model '${model}' not found in any provider` }
    });
  }

  res.json({
    success: true,
    model,
    provider,
    capabilities: ProviderManager.getProviderCapabilities(provider)
  });
}));

/**
 * @route POST /api/ai/validate
 * @desc Validate AI request parameters without processing
 * @access Public
 */
router.post('/validate', asyncHandler(async (req, res) => {
  const { error, value } = generateSchema.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      success: false,
      valid: false,
      error: { message: error.details[0].message }
    });
  }

  const { model, provider } = value;

  // Check if provider and model are available
  if (!ProviderManager.hasProvider(provider)) {
    return res.status(400).json({
      success: false,
      valid: false,
      error: { message: `Provider '${provider}' not available` }
    });
  }

  const supportedModels = ProviderManager.getProvider(provider).getSupportedModels();
  const allModels = [...supportedModels.rest, ...supportedModels.live, ...supportedModels.embeddings];
  if (!allModels.includes(model)) {
    return res.status(400).json({
      success: false,
      valid: false,
      error: { message: `Model '${model}' not supported by provider '${provider}'` }
    });
  }

  res.json({
    success: true,
    valid: true,
    message: 'Request parameters are valid',
    data: value
  });
}));

/**
 * @swagger
 * /api/ai/edit-message:
 *   post:
 *     summary: Edit a user message and regenerate AI response
 *     description: Edit a specific user message, delete all subsequent messages, and generate a new AI response
 *     tags: [AI]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - conversationId
 *               - messageId
 *               - newContent
 *             properties:
 *               userId:
 *                 type: string
 *               conversationId:
 *                 type: string
 *               messageId:
 *                 type: string
 *               newContent:
 *                 type: string
 *               model:
 *                 type: string
 *                 default: gemini-2.5-flash
 *               config:
 *                 type: object
 *     responses:
 *       200:
 *         description: Message edited and AI response generated
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Message or conversation not found
 */
router.post('/edit-message', asyncHandler(async (req, res) => {
  const editMessageSchema = Joi.object({
    userId: Joi.string().required(),
    conversationId: Joi.string().required(),
    messageId: Joi.string().required(),
    newContent: Joi.string().required(),
    files: Joi.array().items(
      Joi.string() // File IDs or URIs
    ).default([]),
    model: Joi.string().default('gemini-2.5-flash'),
    provider: Joi.string().default('google'),
    config: Joi.object({
      temperature: Joi.number().min(0).max(2).default(0.7),
      maxOutputTokens: Joi.number().min(1).max(65536).default(2048),
      topP: Joi.number().min(0).max(1),
      topK: Joi.number().min(1).max(40),
      thinkingConfig: Joi.object({
        thinkingBudget: Joi.number().default(-1),
        includeThoughts: Joi.boolean().default(true)
      })
    }).default({})
  });

  const { error, value } = editMessageSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  const { userId, conversationId, messageId, newContent, files, model, provider, config } = value;

  try {
    // Verify conversation exists and belongs to user
    const conversation = await Conversation.findOne({ conversationId, userId });
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    // Find the message to edit
    const messageToEdit = await Message.findOne({ 
      messageId, 
      conversationId, 
      userId, 
      role: 'user' 
    });

    if (!messageToEdit) {
      return res.status(404).json({
        success: false,
        error: 'User message not found'
      });
    }

    // Delete all messages with sequence greater than the message being edited
    const deleteResult = await Message.deleteMany({
      conversationId,
      messageSequence: { $gt: messageToEdit.messageSequence }
    });

    // Update the message content
    messageToEdit.content.text = newContent;
    messageToEdit.isEdited = true;
    messageToEdit.editHistory.push({
      editedAt: new Date(),
      previousContent: messageToEdit.content,
      reason: 'User edit'
    });
    await messageToEdit.save();

    // Get conversation history up to the edited message
    const historyMessages = await Message.getConversationHistory(conversationId, false);
    const conversationHistory = formatConversationHistory(historyMessages);

    // Prepare messages for AI (include history + edited message)
    let messages = [...conversationHistory];
    
    // Process files and prepare parts for edited user message
    const messageParts = [];
    
    // Get files from the original message (not from request - edit only changes text)
    const originalFiles = messageToEdit.content.files || [];
    const fileIds = originalFiles.map(file => file.fileId).filter(Boolean);
    
    // Add file parts first (if any) from the original message
    if (fileIds.length > 0) {
      for (const fileIdOrUri of fileIds) {
        try {
          let fileData;
          
          // Check if it's a direct URI (for google-file-api)
          if (fileIdOrUri.startsWith('gs://') || fileIdOrUri.startsWith('https://generativelanguage.googleapis.com/')) {
            // Direct Google File API URI
            fileData = {
              fileUri: fileIdOrUri
            };
          } else {
            // Look up file by ID
            const file = await File.findOne({ 
              fileId: fileIdOrUri, 
              userId: userId 
            });
            
            if (!file) {
              console.warn(`File not found: ${fileIdOrUri} for user: ${userId}`);
              continue;
            }
            
            // Check if file is expired
            if (file.isExpired()) {
              console.warn(`File expired: ${fileIdOrUri}`);
              continue;
            }
            
            // Get appropriate URI based on storage method
            if (file.storage.provider === 'google-file-api' && file.aiProviderFile?.fileUri) {
              fileData = {
                fileUri: file.aiProviderFile.fileUri,
                mimeType: file.mimeType
              };
            } else if (file.storage.provider === 'local' && file.storage.path) {
              // Use inline base64 data for local files (more efficient for files <20MB)
              console.log(`📄 Processing local file as inline data for AI: ${fileIdOrUri}`);
              try {
                const fs = await import('fs');
                const fileBuffer = await fs.promises.readFile(file.storage.path);
                const base64Data = fileBuffer.toString('base64');
                
                fileData = {
                  inlineData: {
                    mimeType: file.mimeType,
                    data: base64Data
                  }
                };

                console.log(`✅ Local file processed as inline data (${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
              } catch (readError) {
                console.error(`❌ Failed to read local file: ${readError.message}`);
                continue;
              }
            } else if (file.storage.provider === 's3' && file.storage.url) {
              // For S3, we'd need to download and upload to Google File API first for AI processing
              console.warn(`S3 files need to be downloaded and uploaded to Google File API first for AI processing: ${fileIdOrUri}`);
              console.warn(`This requires additional implementation for S3 file download and re-upload`);
              continue;
            }
          }
          
          if (fileData) {
            // Add fileData directly based on its type
            if (fileData.inlineData) {
              // For inline base64 data
              messageParts.push(fileData);
            } else if (fileData.fileUri) {
              // For Google File API URIs
              messageParts.push({
                fileData: {
                  fileUri: fileData.fileUri,
                  mimeType: fileData.mimeType
                }
              });
            }
          }
        } catch (error) {
          console.error(`Error processing file ${fileIdOrUri}:`, error);
        }
      }
    }
    
    // Add text content
    messageParts.push({ text: newContent });
    
    // Add the edited user message with files and text
    messages.push({
      role: 'user',
      parts: messageParts
    });

    // Prepare generation config
    const generationConfig = {
      model,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      topP: config.topP,
      topK: config.topK,
      systemInstruction: conversation.config?.rest?.systemInstruction
    };

    // Add thinking config if specified
    if (config.thinkingConfig) {
      generationConfig.thinkingConfig = config.thinkingConfig;
    }

    // Generate new AI response
    const aiResponse = await ProviderManager.generateContent({
      provider,
      contents: messages,
      config: generationConfig
    });

    if (!aiResponse.success) {
      return res.status(500).json({
        success: false,
        error: 'AI generation failed',
        details: aiResponse.error
      });
    }

    // Create new model response message
    const modelMessageSequence = conversation.getNextMessageSequence();
    await conversation.save();

    const newModelMessage = new Message({
      messageId: uuidv4(),
      conversationId,
      userId,
      messageSequence: modelMessageSequence,
      messageType: 'rest',
      role: 'model',
      content: {
        text: aiResponse.text,
        thoughts: aiResponse.thoughts
      },
      config: {
        rest: generationConfig
      },
      status: 'completed',
      metadata: {
        timing: {
          requestTime: new Date(),
          responseTime: new Date()
        },
        tokens: {
          input: aiResponse.usageMetadata?.promptTokenCount || 0,
          output: aiResponse.usageMetadata?.candidatesTokenCount || 0,
          total: aiResponse.usageMetadata?.totalTokenCount || 0
        },
        provider: {
          name: provider,
          model,
          apiVersion: aiResponse.apiVersion || '2.5'
        },
        config: {
          temperature: config.temperature,
          maxOutputTokens: config.maxOutputTokens,
          systemInstruction: generationConfig.systemInstruction,
          thinkingConfig: config.thinkingConfig
        }
      }
    });

    await newModelMessage.save();

    // Update conversation stats
    await conversation.incrementStats('rest', aiResponse.usageMetadata?.totalTokenCount || 0);

    // Prepare enhanced response
    const response = {
      success: true,
      provider,
      model,
      conversationId,
      editedMessage: {
        messageId: messageToEdit.messageId,
        messageSequence: messageToEdit.messageSequence,
        content: newContent
      },
      newResponse: {
        messageId: newModelMessage.messageId,
        messageSequence: newModelMessage.messageSequence,
        content: aiResponse.text
      },
      deletedCount: deleteResult.deletedCount,
      text: aiResponse.text,
      thoughts: aiResponse.thoughts,
      hasThoughtSignatures: aiResponse.hasThoughtSignatures,
      usageMetadata: {
        promptTokenCount: aiResponse.usageMetadata?.promptTokenCount || 0,
        candidatesTokenCount: aiResponse.usageMetadata?.candidatesTokenCount || 0,
        totalTokenCount: aiResponse.usageMetadata?.totalTokenCount || 0,
        thoughtsTokenCount: aiResponse.usageMetadata?.thoughtsTokenCount || 0
      },
      modelMetadata: {
        provider,
        model,
        apiVersion: aiResponse.apiVersion || '2.5',
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        systemInstruction: generationConfig.systemInstruction,
        thinkingConfig: config.thinkingConfig
      },
      conversationStats: {
        totalMessages: conversation.stats.totalMessages,
        totalTokens: conversation.stats.totalTokens,
        messageSequence: conversation.stats.messageSequence
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Message Edit Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
}));

/**
 * @route POST /api/ai/regenerate
 * @desc Regenerate AI response for a specific message or the last AI message
 * @access Public
 */
router.post('/regenerate', asyncHandler(async (req, res) => {
  // Validate request
  const { error, value } = regenerateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  const {
    userId,
    conversationId,
    messageId,
    files,
    model,
    provider,
    config
  } = value;

  try {
    // Verify conversation exists
    const conversation = await Conversation.findOne({ conversationId, userId });
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found',
        details: 'Please ensure the conversation exists and belongs to the user'
      });
    }

    // Get user and check subscription plan
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check rate limits
    const userUsage = await UserUsage.findOrCreateUsage(userId, user.subscriptionPlan);
    const rateLimitCheck = userUsage.canMakeRequest(model);
    
    if (!rateLimitCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        details: rateLimitCheck.reason,
        usageInfo: {
          subscriptionPlan: user.subscriptionPlan,
          dailyUsage: userUsage.dailyUsage,
          guestLimits: userUsage.guestLimits,
          totalUsage: userUsage.totalUsage
        }
      });
    }

    // Find the message to regenerate
    let messageToRegenerate;
    if (messageId) {
      // Find specific message
      messageToRegenerate = await Message.findOne({
        messageId,
        conversationId,
        userId,
        role: 'model'
      });
    } else {
      // Find last AI message in conversation
      messageToRegenerate = await Message.findOne({
        conversationId,
        userId,
        role: 'model'
      }).sort({ messageSequence: -1 });
    }

    if (!messageToRegenerate) {
      return res.status(404).json({
        success: false,
        error: 'Message not found',
        details: messageId ? 
          'No AI message found with the specified ID' : 
          'No AI messages found in this conversation'
      });
    }

    // Validate thinking budget if specified
    if (config.thinkingConfig?.thinkingBudget !== undefined) {
      const validation = validateThinkingBudget(model, config.thinkingConfig.thinkingBudget);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid thinking budget',
          details: validation.message
        });
      }
    }

    // Get the user or tool message that preceded this AI message
    const precedingMessage = await Message.findOne({
      conversationId,
      userId,
      role: { $in: ['user', 'tool'] }, // Accept both user messages and tool/plugin messages
      messageSequence: { $lt: messageToRegenerate.messageSequence }
    }).sort({ messageSequence: -1 });

    if (!precedingMessage) {
      return res.status(400).json({
        success: false,
        error: 'Cannot regenerate',
        details: 'No user or tool message found preceding this AI response'
      });
    }

    // Delete all messages after the preceding message (including the current AI message)
    const deleteResult = await Message.deleteMany({
      conversationId,
      userId,
      messageSequence: { $gt: precedingMessage.messageSequence }
    });

    // Get conversation history up to the preceding message
    const historyMessages = await Message.getConversationHistory(conversationId, false);
    const conversationHistory = formatConversationHistory(historyMessages);

    // Prepare messages for AI (include history + preceding message)
    let messages = [...conversationHistory];
    
    // Handle different message types appropriately
    if (precedingMessage.role === 'user') {
      // Regular user message - process files and prepare parts
      const messageParts = [];
      
      // Get files from the preceding user message (not from request)
      const originalFiles = precedingMessage.content.files || [];
      const fileIds = originalFiles.map(file => file.fileId).filter(Boolean);
      
      // Add file parts first (if any) from the preceding message
      if (fileIds.length > 0) {
        for (const fileIdOrUri of fileIds) {
          try {
            let fileData;
            
            // Check if it's a direct URI (for google-file-api)
            if (fileIdOrUri.startsWith('gs://') || fileIdOrUri.startsWith('https://generativelanguage.googleapis.com/')) {
              // Direct Google File API URI
              fileData = {
                fileUri: fileIdOrUri
              };
            } else {
              // Look up file by ID
              const file = await File.findOne({ 
                fileId: fileIdOrUri, 
                userId: userId 
              });
              
              if (!file) {
                console.warn(`File not found: ${fileIdOrUri} for user: ${userId}`);
                continue;
              }
              
              // Check if file is expired
              if (file.isExpired()) {
                console.warn(`File expired: ${fileIdOrUri}`);
                continue;
              }
              
              // Get appropriate URI based on storage method
              if (file.storage.provider === 'google-file-api' && file.aiProviderFile?.fileUri) {
                fileData = {
                  fileUri: file.aiProviderFile.fileUri,
                  mimeType: file.mimeType
                };
              } else if (file.storage.provider === 'local' && file.storage.path) {
                // Use inline base64 data for local files (more efficient for files <20MB)
                console.log(`📄 Processing local file as inline data for AI: ${fileIdOrUri}`);
                try {
                  const fs = await import('fs');
                  const fileBuffer = await fs.promises.readFile(file.storage.path);
                  const base64Data = fileBuffer.toString('base64');
                  
                  fileData = {
                    inlineData: {
                      mimeType: file.mimeType,
                      data: base64Data
                    }
                  };

                  console.log(`✅ Local file processed as inline data (${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
                } catch (readError) {
                  console.error(`❌ Failed to read local file: ${readError.message}`);
                  continue;
                }
              } else if (file.storage.provider === 's3' && file.storage.url) {
                // For S3, we'd need to download and upload to Google File API first for AI processing
                console.warn(`S3 files need to be downloaded and uploaded to Google File API first for AI processing: ${fileIdOrUri}`);
                console.warn(`This requires additional implementation for S3 file download and re-upload`);
                continue;
              }
            }
            
            if (fileData) {
              // Add fileData directly based on its type
              if (fileData.inlineData) {
                // For inline base64 data
                messageParts.push(fileData);
              } else if (fileData.fileUri) {
                // For Google File API URIs
                messageParts.push({
                  fileData: {
                    fileUri: fileData.fileUri,
                    mimeType: fileData.mimeType
                  }
                });
              }
            }
          } catch (error) {
            console.error(`Error processing file ${fileIdOrUri}:`, error);
          }
        }
      }
      
      // Add text content
      messageParts.push({ text: precedingMessage.content.text });
      
      // Add user message with files and text
      messages.push({
        role: 'user',
        parts: messageParts
      });
    } else if (precedingMessage.role === 'tool') {
      // Tool/plugin message - format for AI understanding
      messages.push({
        role: 'user',
        parts: [{ 
          text: `Plugin "${precedingMessage.metadata?.plugin || 'unknown'}" executed with result: ${precedingMessage.content.text}` 
        }]
      });
    }

    // Prepare generation config
    const generationConfig = {
      model,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      topP: config.topP,
      topK: config.topK,
      systemInstruction: config.systemInstruction || conversation.config?.rest?.systemInstruction
    };

    // Add thinking config if specified
    if (config.thinkingConfig) {
      generationConfig.thinkingConfig = config.thinkingConfig;
    }

    // Add tools if specified
    if (config.tools || conversation.config?.rest?.tools) {
      generationConfig.tools = config.tools || conversation.config.rest.tools;
    }

    // Generate new AI response
    const aiResponse = await ProviderManager.generateContent({
      provider,
      contents: messages,
      config: generationConfig
    });

    if (!aiResponse.success) {
      return res.status(500).json({
        success: false,
        error: 'AI generation failed',
        details: aiResponse.error
      });
    }

    // Create new model response message
    const modelMessageSequence = conversation.getNextMessageSequence();
    await conversation.save();

    const newModelMessage = new Message({
      messageId: uuidv4(),
      conversationId,
      userId,
      messageSequence: modelMessageSequence,
      messageType: 'rest',
      role: 'model',
      content: {
        text: aiResponse.text,
        thoughts: aiResponse.thoughts
      },
      config: {
        rest: generationConfig
      },
      status: 'completed',
      metadata: {
        timing: {
          requestTime: new Date(),
          responseTime: new Date()
        },
        tokens: {
          input: aiResponse.usageMetadata?.promptTokenCount || 0,
          output: aiResponse.usageMetadata?.candidatesTokenCount || 0,
          total: aiResponse.usageMetadata?.totalTokenCount || 0
        },
        provider: {
          name: provider,
          model,
          apiVersion: aiResponse.apiVersion || '2.5'
        },
        regeneration: {
          originalMessageId: messageToRegenerate.messageId,
          regeneratedAt: new Date(),
          reason: 'User regeneration request'
        }
      }
    });

    await newModelMessage.save();

    // Record usage for rate limiting
    await userUsage.recordUsage(model, aiResponse.usageMetadata?.totalTokenCount || 0);

    // Update conversation stats
    await conversation.incrementStats('rest', aiResponse.usageMetadata?.totalTokenCount || 0);

    // Prepare enhanced response
    const response = {
      success: true,
      provider,
      model,
      conversationId,
      originalMessage: {
        messageId: messageToRegenerate.messageId,
        messageSequence: messageToRegenerate.messageSequence,
        content: messageToRegenerate.content.text
      },
      regeneratedMessage: {
        messageId: newModelMessage.messageId,
        messageSequence: newModelMessage.messageSequence,
        content: aiResponse.text
      },
      deletedCount: deleteResult.deletedCount,
      text: aiResponse.text,
      thoughts: aiResponse.thoughts,
      hasThoughtSignatures: aiResponse.hasThoughtSignatures,
      usageMetadata: {
        promptTokenCount: aiResponse.usageMetadata?.promptTokenCount || 0,
        candidatesTokenCount: aiResponse.usageMetadata?.candidatesTokenCount || 0,
        totalTokenCount: aiResponse.usageMetadata?.totalTokenCount || 0,
        thoughtsTokenCount: aiResponse.usageMetadata?.thoughtsTokenCount || 0
      },
      modelMetadata: {
        provider,
        model,
        apiVersion: aiResponse.apiVersion || '2.5',
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        topP: config.topP,
        topK: config.topK,
        systemInstruction: generationConfig.systemInstruction,
        thinkingConfig: config.thinkingConfig,
        finishReason: aiResponse.finishReason
      },
      conversationStats: {
        totalMessages: conversation.stats.totalMessages,
        totalTokens: conversation.stats.totalTokens,
        messageSequence: conversation.stats.messageSequence
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Message Regenerate Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
}));

/**
 * @route POST /api/ai/tokens
 * @desc Count tokens for given content
 * @access Public
 */
router.post('/tokens', asyncHandler(async (req, res) => {
  const tokenCountSchema = Joi.object({
    contents: Joi.alternatives().try(
      Joi.string(),
      Joi.array().items(Joi.string()),
      Joi.object()
    ).required(),
    model: Joi.string().default('gemini-2.5-flash'),
    provider: Joi.string().default('google')
  });

  const { error, value } = tokenCountSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { contents, model, provider } = value;

  try {
    // Use ProviderManager to count tokens
    const result = await ProviderManager.countTokens({
      contents,
      model,
      provider
    });

    res.json({
      success: true,
      provider,
      model,
      tokenCount: result.totalTokens || result.tokenCount,
      details: result
    });
  } catch (error) {
    console.error('Token Count Error:', error);
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
}));

/**
 * @route POST /api/ai/update-conversation-title
 * @desc Auto-generate and update conversation title based on content
 * @access Public (with authentication)
 */
router.post('/update-conversation-title', asyncHandler(async (req, res) => {
  const updateTitleSchema = Joi.object({
    userId: Joi.string().required(),
    conversationId: Joi.string().required(),
    model: Joi.string().default('gemini-2.5-flash'),
    provider: Joi.string().default('google')
  });

  const { error, value } = updateTitleSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  const { userId, conversationId, model, provider } = value;

  try {
    // Verify conversation exists and belongs to user
    const conversation = await Conversation.findOne({ conversationId, userId });
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    // Get first 3-4 messages from the conversation to understand the topic
    const messages = await Message.find({
      conversationId,
      userId,
      role: { $in: ['user', 'model'] } // Only user and AI messages
    })
    .sort({ messageSequence: 1 })
    .limit(4); // Get first 4 messages (usually 2 user + 2 AI responses)

    if (messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No messages found in conversation'
      });
    }

    // Prepare conversation content for AI title generation
    let conversationContent = '';
    messages.forEach((msg, index) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const content = msg.content.text || '';
      conversationContent += `${role}: ${content}\n`;
    });

    // Create AI prompt for title generation
    const titlePrompt = `Based on the following conversation, generate a concise, descriptive title (3-6 words maximum) that captures the main topic or question being discussed. The title should be clear, specific, and helpful for identifying the conversation later.

Conversation:
${conversationContent}

Generate only the title, nothing else. Do not use quotes or extra formatting.`;

    // Generate title using AI
    const aiResponse = await ProviderManager.generateContent({
      provider,
      contents: [{
        role: 'user',
        parts: [{ text: titlePrompt }]
      }],
      config: {
        model,
        temperature: 0.3, // Lower temperature for more consistent results
        maxOutputTokens: 50, // Short response
        systemInstruction: 'You are an expert at creating concise, descriptive titles for conversations. Generate titles that are 3-6 words and clearly identify the main topic.'
      }
    });

    if (!aiResponse.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate title',
        details: aiResponse.error
      });
    }

    // Clean up the generated title
    let newTitle = aiResponse.text.trim();
    
    // Remove quotes if present
    newTitle = newTitle.replace(/^["']|["']$/g, '');
    
    // Limit length to 100 characters max
    if (newTitle.length > 100) {
      newTitle = newTitle.substring(0, 97) + '...';
    }
    
    // Fallback if title is empty or too short
    if (!newTitle || newTitle.length < 3) {
      newTitle = 'New Conversation';
    }

    // Store previous title before updating
    const previousTitle = conversation.title;
    
    // Update conversation title
    conversation.title = newTitle;
    await conversation.save();

    // Return success response
    res.json({
      success: true,
      conversationId,
      previousTitle: previousTitle,
      newTitle: newTitle,
      generatedFrom: {
        messageCount: messages.length,
        provider,
        model
      },
      usageMetadata: {
        promptTokenCount: aiResponse.usageMetadata?.promptTokenCount || 0,
        candidatesTokenCount: aiResponse.usageMetadata?.candidatesTokenCount || 0,
        totalTokenCount: aiResponse.usageMetadata?.totalTokenCount || 0
      }
    });

  } catch (error) {
    console.error('Update Conversation Title Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
}));

export default router; 