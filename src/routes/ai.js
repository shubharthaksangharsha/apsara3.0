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
    // 2.5 Pro: Cannot disable thinking, range 128-32768
    if (thinkingBudget === 0) {
      return { 
        valid: false, 
        message: 'Gemini 2.5 Pro cannot disable thinking. Use -1 for dynamic thinking or range 128-32768.' 
      };
    }
    if (thinkingBudget > 0 && (thinkingBudget < 128 || thinkingBudget > 32768)) {
      return { 
        valid: false, 
        message: 'Gemini 2.5 Pro thinking budget must be -1 (dynamic) or between 128-32768.' 
      };
    }
  } else if (model === 'gemini-2.5-flash') {
    // 2.5 Flash: Can disable (0), range 0-24576
    if (thinkingBudget > 24576) {
      return { 
        valid: false, 
        message: 'Gemini 2.5 Flash thinking budget must be -1 (dynamic), 0 (off), or between 1-24576.' 
      };
    }
  } else if (model === 'gemini-2.5-flash-lite') {
    // 2.5 Flash Lite: Range 512-24576 or 0 to disable
    if (thinkingBudget > 0 && thinkingBudget < 512) {
      return { 
        valid: false, 
        message: 'Gemini 2.5 Flash Lite thinking budget must be -1 (dynamic), 0 (off), or between 512-24576.' 
      };
    }
    if (thinkingBudget > 24576) {
      return { 
        valid: false, 
        message: 'Gemini 2.5 Flash Lite thinking budget must be -1 (dynamic), 0 (off), or between 512-24576.' 
      };
    }
  }

  return { valid: true };
}

// Validation schemas
const generateContentSchema = Joi.object({
  contents: Joi.alternatives().try(
    Joi.string(),
    Joi.array().items(Joi.object({
      text: Joi.string(),
      inlineData: Joi.object({
        mimeType: Joi.string(),
        data: Joi.string()
      }),
      fileData: Joi.object({
        mimeType: Joi.string(),
        fileUri: Joi.string()
      })
    }))
  ).required(),
  model: Joi.string().valid('gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite').default('gemini-2.5-flash'),
  provider: Joi.string().valid('google').default('google'),
  config: Joi.object({
    systemInstruction: Joi.string(),
    temperature: Joi.number().min(0).max(2).default(0.7),
    maxOutputTokens: Joi.number().min(1).max(8192).default(2048),
    topP: Joi.number().min(0).max(1).default(0.9),
    topK: Joi.number().min(1).max(100).default(40),
    thinkingConfig: Joi.object({
      thinkingBudget: Joi.number().integer().min(-1).max(32768).default(-1), // -1 = AUTO/Dynamic, 0 = OFF, positive = specific budget
      includeThoughts: Joi.boolean().default(false) // Enable thought summaries
    }),
    tools: Joi.array().items(Joi.object()),

  }).default({})
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
 * @route POST /api/ai/generate
 * @desc Generate AI content (text/multimodal)
 * @access Public (with rate limiting)
 */
router.post('/generate', asyncHandler(async (req, res) => {
  const { error, value } = generateContentSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { contents, model, provider, config } = value;

  // Validate thinking budget for the specific model
  if (config.thinkingConfig && config.thinkingConfig.thinkingBudget !== undefined) {
    const budgetValidation = validateThinkingBudget(model, config.thinkingConfig.thinkingBudget);
    if (!budgetValidation.valid) {
      return res.status(400).json({
        success: false,
        error: { message: budgetValidation.message }
      });
    }
  }

  // REST API is streaming-only
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  try {
    const stream = ProviderManager.generateContentStream({
      contents,
      model,
      provider,
      config
    });

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ success: false, error: { message: error.message } })}\n\n`);
    res.end();
  }
}));

/**
 * @route POST /api/ai/chat
 * @desc Multi-turn conversation endpoint
 * @access Public (with rate limiting)
 */
router.post('/chat', asyncHandler(async (req, res) => {
  const schema = Joi.object({
    messages: Joi.array().items(
      Joi.object({
        role: Joi.string().valid('user', 'model', 'system').required(),
        parts: Joi.array().items(
          Joi.object({
            text: Joi.string(),
            inlineData: Joi.object({
              mimeType: Joi.string(),
              data: Joi.string()
            }),
            fileData: Joi.object({
              mimeType: Joi.string(),
              fileUri: Joi.string()
            })
          })
        ).required()
      })
    ).required(),
    model: Joi.string().valid('gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite').default('gemini-2.5-flash'),
    provider: Joi.string().valid('google').default('google'),
    config: Joi.object({
      systemInstruction: Joi.string(),
      temperature: Joi.number().min(0).max(2).default(0.7),
      maxOutputTokens: Joi.number().min(1).max(8192).default(2048),
      thinkingConfig: Joi.object({
        thinkingBudget: Joi.number().integer().min(-1).max(32768).default(-1), // -1 = AUTO/Dynamic, 0 = OFF, positive = specific budget
        includeThoughts: Joi.boolean().default(false) // Enable thought summaries
      }),
      tools: Joi.array().items(Joi.object())
    }).default({})
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { messages, model, provider, config } = value;

  // Validate thinking budget for the specific model
  if (config.thinkingConfig && config.thinkingConfig.thinkingBudget !== undefined) {
    const budgetValidation = validateThinkingBudget(model, config.thinkingConfig.thinkingBudget);
    if (!budgetValidation.valid) {
      return res.status(400).json({
        success: false,
        error: { message: budgetValidation.message }
      });
    }
  }

  // Convert messages to contents format
  const contents = messages.map(msg => ({
    role: msg.role,
    parts: msg.parts
  }));

  // Chat API is streaming-only
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  try {
    const stream = ProviderManager.generateContentStream({
      contents,
      model,
      provider,
      config
    });

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ success: false, error: { message: error.message } })}\n\n`);
    res.end();
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
  const { error, value } = generateContentSchema.validate(req.body);
  
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
  if (!supportedModels.includes(model)) {
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

export default router; 