import express from 'express';
import Joi from 'joi';
import { asyncHandler } from '../middleware/errorHandler.js';
import ProviderManager from '../providers/ProviderManager.js';

const router = express.Router();

// Validation schemas
const functionCallSchema = Joi.object({
  provider: Joi.string().valid('google').default('google'),
  model: Joi.string().default('gemini-2.0-flash-live-001'),
  contents: Joi.alternatives().try(
    Joi.string(),
    Joi.array()
  ).required(),
  tools: Joi.array().items(
    Joi.object({
      functionDeclarations: Joi.array().items(
        Joi.object({
          name: Joi.string().required(),
          description: Joi.string(),
          parameters: Joi.object(),
          behavior: Joi.string().valid('BLOCKING', 'NON_BLOCKING')
        })
      ),
      codeExecution: Joi.object(),
      googleSearch: Joi.object()
    })
  ).required(),
  config: Joi.object({
    systemInstruction: Joi.string(),
    temperature: Joi.number().min(0).max(2).default(0.7),
    maxOutputTokens: Joi.number().min(1).max(8192).default(2048)
  }).default({})
});

// Code execution and Google Search are now handled as external plugins

/**
 * @route POST /api/tools/function-call
 * @desc Execute function calling with custom tools
 * @access Public (with rate limiting)
 */
router.post('/function-call', asyncHandler(async (req, res) => {
  const { error, value } = functionCallSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { provider, model, contents, tools, config } = value;

  const result = await ProviderManager.generateContent({
    provider,
    model,
    contents,
    config: {
      ...config,
      tools
    }
  });

  res.json(result);
}));

// Code execution and Google Search endpoints removed - now handled as external plugins

/**
 * @route POST /api/tools/combined
 * @desc Use multiple tools together
 * @access Public (with rate limiting)
 */
router.post('/combined', asyncHandler(async (req, res) => {
  const schema = Joi.object({
    provider: Joi.string().valid('google').default('google'),
    model: Joi.string().default('gemini-2.0-flash-live-001'),
    contents: Joi.alternatives().try(
      Joi.string(),
      Joi.array()
    ).required(),
    enabledTools: Joi.object({
      functionCalling: Joi.array().items(
        Joi.object({
          name: Joi.string().required(),
          description: Joi.string(),
          parameters: Joi.object(),
          behavior: Joi.string().valid('BLOCKING', 'NON_BLOCKING')
        })
      )
    }).required(),
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

  const { provider, model, contents, enabledTools, config } = value;

  // Build tools array based on enabled tools
  const tools = [];

  if (enabledTools.functionCalling && enabledTools.functionCalling.length > 0) {
    tools.push({
      functionDeclarations: enabledTools.functionCalling
    });
  }

  if (tools.length === 0) {
    return res.status(400).json({
      success: false,
      error: { message: 'At least one function must be provided for function calling' }
    });
  }

  const result = await ProviderManager.generateContent({
    provider,
    model,
    contents,
    config: {
      ...config,
      tools
    }
  });

  res.json(result);
}));

/**
 * @route GET /api/tools/capabilities
 * @desc Get available tools and their capabilities by provider
 * @access Public
 */
router.get('/capabilities', asyncHandler(async (req, res) => {
  const { provider } = req.query;

  if (provider && !ProviderManager.hasProvider(provider)) {
    return res.status(404).json({
      success: false,
      error: { message: `Provider '${provider}' not found` }
    });
  }

  if (provider) {
    // Get capabilities for specific provider
    const capabilities = ProviderManager.getProviderCapabilities(provider);
    res.json({
      success: true,
      provider,
      capabilities: {
        functionCalling: capabilities.functionCalling
      }
    });
  } else {
    // Get capabilities for all providers
    const allCapabilities = ProviderManager.getAllCapabilities();
    const toolCapabilities = {};

    for (const [providerName, caps] of Object.entries(allCapabilities)) {
      toolCapabilities[providerName] = {
        functionCalling: caps.functionCalling
      };
    }

    res.json({
      success: true,
      capabilities: toolCapabilities
    });
  }
}));

/**
 * @route GET /api/tools/examples
 * @desc Get example tool configurations
 * @access Public
 */
router.get('/examples', (req, res) => {
  const examples = {
    functionCalling: {
      simpleFunction: {
        name: 'get_weather',
        description: 'Get current weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'City name or location'
            },
            unit: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
              description: 'Temperature unit'
            }
          },
          required: ['location']
        }
      },
      complexFunction: {
        name: 'send_email',
        description: 'Send an email to recipients',
        parameters: {
          type: 'object',
          properties: {
            to: {
              type: 'array',
              items: { type: 'string' },
              description: 'Email recipients'
            },
            subject: {
              type: 'string',
              description: 'Email subject'
            },
            body: {
              type: 'string',
              description: 'Email body content'
            },
            priority: {
              type: 'string',
              enum: ['low', 'normal', 'high'],
              default: 'normal'
            }
          },
          required: ['to', 'subject', 'body']
        },
        behavior: 'NON_BLOCKING'
      }
    }
  };

  res.json({
    success: true,
    examples,
    usage: {
      functionCalling: 'POST /api/tools/function-call',
      combined: 'POST /api/tools/combined'
    }
  });
});

/**
 * @route POST /api/tools/validate
 * @desc Validate tool configuration
 * @access Public
 */
router.post('/validate', asyncHandler(async (req, res) => {
  const schema = Joi.object({
    tools: Joi.array().items(
      Joi.object({
        functionDeclarations: Joi.array().items(
          Joi.object({
            name: Joi.string().required(),
            description: Joi.string(),
            parameters: Joi.object(),
            behavior: Joi.string().valid('BLOCKING', 'NON_BLOCKING')
          })
        )
      })
    ).required(),
    provider: Joi.string().valid('google').default('google')
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      valid: false,
      error: { message: error.details[0].message }
    });
  }

  const { tools, provider } = value;

  // Check if provider supports the requested tools
  const capabilities = ProviderManager.getProviderCapabilities(provider);
  const validationResults = [];

  for (const tool of tools) {
    if (tool.functionDeclarations) {
      if (!capabilities.functionCalling) {
        validationResults.push({
          tool: 'functionCalling',
          valid: false,
          message: `Provider '${provider}' does not support function calling`
        });
      } else {
        validationResults.push({
          tool: 'functionCalling',
          valid: true,
          functions: tool.functionDeclarations.length
        });
      }
    }

    // Code execution and Google Search validation removed - handled as external plugins
  }

  const allValid = validationResults.every(result => result.valid);

  res.json({
    success: true,
    valid: allValid,
    provider,
    results: validationResults
  });
}));

export default router; 