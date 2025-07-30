import express from 'express';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler } from '../middleware/errorHandler.js';
import ProviderManager from '../providers/ProviderManager.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';

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
  } else if (model === 'gemini-2.5-flash-lite') {
    // Flash-Lite can be disabled (0) or 512-24576
    if (thinkingBudget !== 0 && (thinkingBudget < 512 || thinkingBudget > 24576)) {
      return {
        valid: false,
        message: 'Gemini 2.5 Flash-Lite thinking budget must be 0 (disabled) or between 512-24576 tokens'
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
  model: Joi.string().default('gemini-2.5-flash'),
  provider: Joi.string().default('google'),
  config: Joi.object({
    temperature: Joi.number().min(0).max(2).default(0.7),
    maxOutputTokens: Joi.number().min(1).max(8192).default(2048),
    topP: Joi.number().min(0).max(1),
    topK: Joi.number().min(1).max(40),
    systemInstruction: Joi.string(),
    tools: Joi.array(),
    thinkingConfig: Joi.object({
      thinkingBudget: Joi.number().default(-1),
      includeThoughts: Joi.boolean().default(true)
    }),
    conversationHistory: Joi.object({
      include: Joi.boolean().default(true),
      maxMessages: Joi.number().min(1).max(100).default(20),
      includeThoughts: Joi.boolean().default(false)
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

    // Get conversation history if requested
    let conversationHistory = [];
    if (config.conversationHistory?.include) {
      const historyMessages = await Message.getConversationHistory(
        conversationId,
        config.conversationHistory.includeThoughts
      );
      conversationHistory = formatConversationHistory(
        historyMessages.slice(-config.conversationHistory.maxMessages),
        config.conversationHistory.includeThoughts
      );
    }

    // Get next message sequence
    const messageSequence = conversation.getNextMessageSequence();
    await conversation.save();

    // Create user message
    const userMessageId = uuidv4();
    const userMessage = new Message({
      messageId: userMessageId,
      conversationId,
      userId,
      messageSequence,
      messageType: 'rest',
      role: 'user',
      content: {
        text: typeof contents === 'string' ? contents : JSON.stringify(contents)
      },
      status: 'completed',
      metadata: {
        timing: {
          requestTime: new Date()
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

    // Add current user message
    if (typeof contents === 'string') {
      messages.push({
        role: 'user',
        parts: [{ text: contents }]
      });
    } else {
      messages.push({
        role: 'user',
        parts: Array.isArray(contents) ? contents : [contents]
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
        included: config.conversationHistory?.include || false,
        messageCount: conversationHistory.length,
        maxMessages: config.conversationHistory?.maxMessages || 0
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
    model: Joi.string().default('gemini-2.5-flash'),
    provider: Joi.string().default('google'),
    config: Joi.object({
      temperature: Joi.number().min(0).max(2).default(0.7),
      maxOutputTokens: Joi.number().min(1).max(8192).default(2048),
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

  const { userId, conversationId, messageId, newContent, model, provider, config } = value;

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
    messages.push({
      role: 'user',
      parts: [{ text: newContent }]
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

export default router; 