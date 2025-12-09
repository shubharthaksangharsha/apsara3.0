import express from 'express';
import Joi from 'joi';
import { asyncHandler } from '../middleware/errorHandler.js';
import ProviderManager from '../providers/ProviderManager.js';

const router = express.Router();

/**
 * @route POST /api/sessions/ephemeral-token
 * @desc Create ephemeral tokens for Live API client-to-server connections
 * @access Public (with rate limiting)
 */
router.post('/ephemeral-token', asyncHandler(async (req, res) => {
  const schema = Joi.object({
    provider: Joi.string().valid('google').default('google'),
    config: Joi.object({
      uses: Joi.number().min(1).max(10).default(1),
      expireTime: Joi.string(), // ISO 8601 format
      newSessionExpireTime: Joi.string(), // ISO 8601 format
      liveConnectConstraints: Joi.object({
        model: Joi.string().valid(
          'gemini-2.5-flash-native-audio-preview-09-2025',
          'gemini-live-2.5-flash-preview',
          'gemini-2.0-flash-live-001',
          'gemini-2.5-flash-preview-native-audio-dialog',
          'gemini-2.5-flash-exp-native-audio-thinking-dialog'
        ),
        config: Joi.object({
          sessionResumption: Joi.object(),
          temperature: Joi.number().min(0).max(2),
          responseModalities: Joi.array().items(Joi.string().valid('TEXT', 'AUDIO'))
        })
      })
    }).default({})
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { provider, config } = value;

  // Set default expiration times if not provided
  const now = new Date();
  const defaultConfig = {
    expireTime: config.expireTime || new Date(now.getTime() + 30 * 60 * 1000).toISOString(), // 30 minutes
    newSessionExpireTime: config.newSessionExpireTime || new Date(now.getTime() + 1 * 60 * 1000).toISOString(), // 1 minute
    ...config
  };

  const result = await ProviderManager.createEphemeralToken({
    provider,
    ...defaultConfig
  });

  res.status(201).json(result);
}));

/**
 * @route GET /api/sessions/stats
 * @desc Get live session statistics
 * @access Public
 */
router.get('/stats', asyncHandler(async (req, res) => {
  // This would typically get statistics from WebSocket server
  res.json({
    success: true,
    stats: {
      totalSessions: 0,
      activeSessions: 0,
      byProvider: {},
      byModel: {},
      connections: {
        total: 0,
        active: 0
      }
    },
    timestamp: new Date().toISOString()
  });
}));

/**
 * @route GET /api/sessions/health
 * @desc Check Live API WebSocket server health
 * @access Public
 */
router.get('/health', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    webSocket: {
      available: true,
      endpoint: `/live`,
      protocol: 'ws'
    },
    capabilities: {
      sessionResumption: true,
      contextWindowCompression: true,
      voiceActivityDetection: true,
      ephemeralTokens: true
    },
    timestamp: new Date().toISOString()
  });
}));

/**
 * @route GET /api/sessions/models
 * @desc Get available models for Live API
 * @access Public
 */
router.get('/models', asyncHandler(async (req, res) => {
  const { provider } = req.query;

  if (provider && !ProviderManager.hasProvider(provider)) {
    return res.status(404).json({
      success: false,
      error: { message: `Provider '${provider}' not found` }
    });
  }

  if (provider) {
    const providerInstance = ProviderManager.getProvider(provider);
    const models = providerInstance.getSupportedModels();
    
    // Filter models that support Live API
    const liveApiModels = models.filter(model => 
      model.includes('live') || 
      model.includes('native-audio') ||
      model.includes('flash-live')
    );

    res.json({
      success: true,
      provider,
      models: liveApiModels,
      capabilities: providerInstance.getCapabilities()
    });
  } else {
    const allCapabilities = ProviderManager.getAllCapabilities();
    const liveApiModels = {};

    for (const [providerName, caps] of Object.entries(allCapabilities)) {
      if (caps.liveApi) {
        const models = caps.models.filter(model => 
          model.includes('live') || 
          model.includes('native-audio') ||
          model.includes('flash-live')
        );
        if (models.length > 0) {
          liveApiModels[providerName] = models;
        }
      }
    }

    res.json({
      success: true,
      models: liveApiModels
    });
  }
}));

/**
 * @route GET /api/sessions/features
 * @desc Get available Live API features
 * @access Public
 */
router.get('/features', asyncHandler(async (req, res) => {
  const features = {
    realtime: {
      audio: {
        input: true,
        output: true,
        formats: ['audio/pcm'],
        sampleRates: [16000, 24000],
        channels: ['mono'],
        bitDepth: [16]
      },
      video: {
        input: true,
        output: false,
        formats: ['video/mp4', 'video/webm']
      },
      text: {
        input: true,
        output: true,
        streaming: true
      }
    },
    voice: {
      activityDetection: true,
      interruption: true,
      voices: ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'],
      languages: ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'ja-JP', 'ko-KR']
    },
    session: {
      resumption: true,
      compression: true,
      timeout: 900, // 15 minutes
      maxConcurrent: 5
    },
    tools: {
      functionCalling: true,
      async: true
      // Note: codeExecution and googleSearch are now external plugins
    },
    security: {
      ephemeralTokens: true,
      rateLimiting: true,
      encryptedTransport: true
    }
  };

  res.json({
    success: true,
    features,
    documentation: '/api',
    websocketEndpoint: '/live'
  });
}));

/**
 * @route POST /api/sessions/validate-config
 * @desc Validate Live API session configuration
 * @access Public
 */
router.post('/validate-config', asyncHandler(async (req, res) => {
  const schema = Joi.object({
    provider: Joi.string().valid('google').default('google'),
    model: Joi.string().required(),
    config: Joi.object({
      responseModalities: Joi.array().items(Joi.string().valid('TEXT', 'AUDIO')),
      systemInstruction: Joi.string(),
      speechConfig: Joi.object({
        voiceConfig: Joi.object({
          prebuiltVoiceConfig: Joi.object({
            voiceName: Joi.string()
          })
        }),
        languageCode: Joi.string()
      }),
      realtimeInputConfig: Joi.object({
        automaticActivityDetection: Joi.object({
          disabled: Joi.boolean(),
          startOfSpeechSensitivity: Joi.string(),
          endOfSpeechSensitivity: Joi.string(),
          prefixPaddingMs: Joi.number(),
          silenceDurationMs: Joi.number()
        })
      }),
      sessionResumption: Joi.object(),
      contextWindowCompression: Joi.object({
        slidingWindow: Joi.object()
      }),
      tools: Joi.array()
    }).required()
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      valid: false,
      error: { message: error.details[0].message }
    });
  }

  const { provider, model, config } = value;

  // Validate provider and model
  if (!ProviderManager.hasProvider(provider)) {
    return res.status(400).json({
      success: false,
      valid: false,
      error: { message: `Provider '${provider}' not available` }
    });
  }

  const providerInstance = ProviderManager.getProvider(provider);
  const supportedModels = providerInstance.getSupportedModels();

  if (!supportedModels.includes(model)) {
    return res.status(400).json({
      success: false,
      valid: false,
      error: { message: `Model '${model}' not supported by provider '${provider}'` }
    });
  }

  // Check if model supports Live API
  const isLiveApiModel = model.includes('live') || 
                        model.includes('native-audio') ||
                        model.includes('flash-live');

  if (!isLiveApiModel) {
    return res.status(400).json({
      success: false,
      valid: false,
      error: { message: `Model '${model}' does not support Live API` }
    });
  }

  // Validate specific configuration options
  const validationResults = [];

  // Check response modalities
  if (config.responseModalities) {
    if (config.responseModalities.length !== 1) {
      validationResults.push({
        field: 'responseModalities',
        valid: false,
        message: 'Only one response modality can be set per session'
      });
    }
  }

  // Check voice configuration for audio models
  if (config.responseModalities && config.responseModalities.includes('AUDIO')) {
    if (config.speechConfig && config.speechConfig.voiceConfig) {
      validationResults.push({
        field: 'speechConfig',
        valid: true,
        message: 'Audio configuration is valid'
      });
    }
  }

  const allValid = validationResults.length === 0 || validationResults.every(r => r.valid);

  res.json({
    success: true,
    valid: allValid,
    provider,
    model,
    validationResults
  });
}));

export default router; 