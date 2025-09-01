import express from 'express';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler } from '../middleware/errorHandler.js';
import ProviderManager from '../providers/ProviderManager.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';

const router = express.Router();

// Plugin definitions
const plugins = {
  google: {
    calculator: {
      name: 'calculator',
      description: 'Performs basic mathematical operations',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['add', 'subtract', 'multiply', 'divide'],
            description: 'The mathematical operation to perform'
          },
          number1: {
            type: 'number',
            description: 'First number'
          },
          number2: {
            type: 'number',
            description: 'Second number'
          }
        },
        required: ['operation', 'number1', 'number2']
      }
    },
    echo: {
      name: 'echo',
      description: 'Echoes back the provided message',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Message to echo back'
          }
        },
        required: ['message']
      }
    }
  }
};

// Validation schemas
const pluginExecutionSchema = Joi.object({
  userId: Joi.string().required(),
  conversationId: Joi.string().required(),
  parameters: Joi.object().required(),
  sendToModel: Joi.boolean().default(false),
  runAsync: Joi.boolean().default(false),
  modelConfig: Joi.object({
    model: Joi.string().default('gemini-2.5-flash'),
    provider: Joi.string().default('google'),
    temperature: Joi.number().min(0).max(2).default(0.7),
    maxOutputTokens: Joi.number().min(1).max(65536).default(2048),
    topP: Joi.number().min(0).max(1),
    topK: Joi.number().min(1).max(40),
    includeConversationHistory: Joi.boolean().default(true),
    maxHistoryMessages: Joi.number().min(1).max(50).default(10),
    systemInstruction: Joi.string(),
    thinkingConfig: Joi.object({
      thinkingBudget: Joi.number().default(-1),
      includeThoughts: Joi.boolean().default(true)
    })
  }).when('sendToModel', { is: true, then: Joi.required() })
});



// Plugin execution functions
const pluginExecutors = {
  calculator: (params) => {
    const { operation, number1, number2 } = params;
    let result;
    
    switch (operation) {
      case 'add':
        result = number1 + number2;
        break;
      case 'subtract':
        result = number1 - number2;
        break;
      case 'multiply':
        result = number1 * number2;
        break;
      case 'divide':
        if (number2 === 0) {
          throw new Error('Division by zero is not allowed');
        }
        result = number1 / number2;
        break;
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }
    
    return {
      success: true,
      result,
      operation,
      operands: { number1, number2 },
      message: `${number1} ${operation} ${number2} = ${result}`
    };
  },
  
  echo: (params) => {
    const { message } = params;
    return {
      success: true,
      echo: message,
      timestamp: new Date().toISOString(),
      message: `Echo: ${message}`
    };
  }
};

/**
 * Format conversation history for AI provider
 */
function formatConversationHistory(messages) {
  return messages.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.content.text }]
  }));
}

/**
 * Create and save plugin response message
 */
async function createPluginMessage(conversationId, userId, pluginName, parameters, result, isToolCall = false) {
  const conversation = await Conversation.findOne({ conversationId, userId });
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const messageSequence = conversation.getNextMessageSequence();
  await conversation.save();

  const message = new Message({
    messageId: uuidv4(),
    conversationId,
    userId,
    messageSequence,
    messageType: 'rest',
    role: 'tool',
    content: {
      text: JSON.stringify(result)
    },
    functionCall: {
      isToolCall,
      functionName: pluginName,
      functionArgs: parameters,
      functionResponse: result,
      status: 'completed',
      executionTime: Date.now()
    },
    status: 'completed',
    metadata: {
      timing: {
        requestTime: new Date(),
        responseTime: new Date()
      },
      provider: {
        name: 'apsara-plugins'
      }
    }
  });

  await message.save();
  await conversation.incrementStats('rest', 0);
  
  return message;
}

/**
 * @swagger
 * /api/plugins/list_plugins:
 *   get:
 *     summary: List all available plugins
 *     description: Get a list of all available plugins across all providers
 *     tags: [Plugins]
 *     responses:
 *       200:
 *         description: List of plugins retrieved successfully
 */
router.get('/list_plugins', asyncHandler(async (req, res) => {
  const allPlugins = {};
  
  Object.keys(plugins).forEach(provider => {
    allPlugins[provider] = Object.keys(plugins[provider]).map(pluginName => ({
      name: pluginName,
      description: plugins[provider][pluginName].description,
      parameters: plugins[provider][pluginName].parameters
    }));
  });

  res.json({
    success: true,
    providers: Object.keys(plugins),
    plugins: allPlugins,
    totalPlugins: Object.values(allPlugins).reduce((sum, providerPlugins) => sum + providerPlugins.length, 0)
  });
}));

/**
 * @swagger
 * /api/plugins/{provider}:
 *   get:
 *     summary: List plugins for a specific provider
 *     description: Get all plugins available for a specific provider
 *     tags: [Plugins]
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *         description: Provider name (e.g., google)
 *     responses:
 *       200:
 *         description: Provider plugins retrieved successfully
 *       404:
 *         description: Provider not found
 */
router.get('/:provider', asyncHandler(async (req, res) => {
  const { provider } = req.params;
  
  if (!plugins[provider]) {
    return res.status(404).json({
      success: false,
      error: 'Provider not found',
      availableProviders: Object.keys(plugins)
    });
  }

  const providerPlugins = Object.keys(plugins[provider]).map(pluginName => ({
    name: pluginName,
    description: plugins[provider][pluginName].description,
    parameters: plugins[provider][pluginName].parameters,
    endpoint: `/api/plugins/${provider}/${pluginName}/send`
  }));

  res.json({
    success: true,
    provider,
    plugins: providerPlugins,
    count: providerPlugins.length
  });
}));

/**
 * @swagger
 * /api/plugins/{provider}/{plugin}/send:
 *   post:
 *     summary: Execute a specific plugin
 *     description: Execute a plugin with parameters and optionally send result to AI model
 *     tags: [Plugins]
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *         description: Provider name
 *       - in: path
 *         name: plugin
 *         required: true
 *         schema:
 *           type: string
 *         description: Plugin name
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - conversationId
 *               - parameters
 *             properties:
 *               userId:
 *                 type: string
 *               conversationId:
 *                 type: string
 *               parameters:
 *                 type: object
 *               sendToModel:
 *                 type: boolean
 *                 default: false
 *               modelConfig:
 *                 type: object
 *                 properties:
 *                   model:
 *                     type: string
 *                     default: gemini-2.5-flash
 *                   provider:
 *                     type: string
 *                     default: google
 *     responses:
 *       200:
 *         description: Plugin executed successfully
 *       400:
 *         description: Invalid parameters
 *       404:
 *         description: Plugin not found
 */
router.post('/:provider/:plugin/send', asyncHandler(async (req, res) => {
  const { provider, plugin } = req.params;
  
  // Validate input
  const { error, value } = pluginExecutionSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: error.details.map(d => d.message)
    });
  }

  const { userId, conversationId, parameters, sendToModel, runAsync, modelConfig } = value;

  // Check if plugin exists
  if (!plugins[provider] || !plugins[provider][plugin]) {
    return res.status(404).json({
      success: false,
      error: 'Plugin not found',
      availableProviders: Object.keys(plugins),
      availablePlugins: plugins[provider] ? Object.keys(plugins[provider]) : []
    });
  }

  // Verify conversation exists
  const conversation = await Conversation.findOne({ conversationId, userId });
  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: 'Conversation not found'
    });
  }

  try {
    // Handle async execution
    if (runAsync) {
      const taskId = uuidv4();
      
      // Start async execution
      setImmediate(async () => {
        try {
          const pluginResult = pluginExecutors[plugin](parameters);
          
          // Create plugin message in database
          const pluginMessage = await createPluginMessage(
            conversationId, 
            userId, 
            plugin, 
            parameters, 
            pluginResult, 
            false
          );

          // If sendToModel is true, also send to AI and store response
          if (sendToModel && modelConfig) {
            try {
              // Get conversation history for AI context
              const historyMessages = await Message.getConversationHistory(conversationId, false);
              const conversationHistory = formatConversationHistory(historyMessages, false);

              // Prepare messages for AI
              let messages = [...conversationHistory];
              
              // Add plugin result as context
              messages.push({
                role: 'user',
                parts: [{
                  text: `Plugin "${plugin}" execution result: ${JSON.stringify(pluginResult, null, 2)}\n\nPlease analyze this result and provide insights or explanations.`
                }]
              });

              // Generate AI response
              const aiResponse = await ProviderManager.generateContent({
                provider: modelConfig.provider,
                contents: messages,
                config: {
                  model: modelConfig.model,
                  temperature: modelConfig.temperature,
                  maxOutputTokens: modelConfig.maxOutputTokens,
                  topP: modelConfig.topP,
                  topK: modelConfig.topK,
                  systemInstruction: modelConfig.systemInstruction || conversation.config?.rest?.systemInstruction,
                  thinkingConfig: modelConfig.thinkingConfig
                }
              });

              if (aiResponse.success) {
                // Create AI response message
                const aiMessageSequence = conversation.getNextMessageSequence();
                await conversation.save();

                const aiMessage = new Message({
                  messageId: uuidv4(),
                  conversationId,
                  userId,
                  messageSequence: aiMessageSequence,
                  messageType: 'rest',
                  role: 'model',
                  content: {
                    text: aiResponse.text,
                    thoughts: aiResponse.thoughts
                  },
                  config: {
                    rest: modelConfig
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
                      name: modelConfig.provider,
                      model: modelConfig.model,
                      apiVersion: aiResponse.apiVersion || '2.5'
                    },
                    config: {
                      temperature: modelConfig.temperature,
                      maxOutputTokens: modelConfig.maxOutputTokens,
                      systemInstruction: modelConfig.systemInstruction || conversation.config?.rest?.systemInstruction,
                      thinkingConfig: modelConfig.thinkingConfig
                    }
                  }
                });

                await aiMessage.save();
                await conversation.incrementStats('rest', aiResponse.usageMetadata?.totalTokenCount || 0);
                
                console.log(`✅ Async plugin ${plugin} completed with AI response (taskId: ${taskId})`);
              } else {
                console.log(`⚠️ Async plugin ${plugin} completed but AI response failed (taskId: ${taskId}):`, aiResponse.error);
              }
            } catch (aiError) {
              console.error(`❌ Async plugin ${plugin} AI processing failed (taskId: ${taskId}):`, aiError);
            }
          }

          console.log(`✅ Async plugin ${plugin} completed with taskId: ${taskId}`);
        } catch (error) {
          console.error(`❌ Async plugin ${plugin} failed with taskId: ${taskId}`, error);
        }
      });

      // Return immediately with task ID
      return res.json({
        success: true,
        plugin,
        provider,
        conversationId,
        taskId,
        status: 'started',
        message: 'Plugin execution started asynchronously',
        runAsync: true
      });
    }

    // Synchronous execution (existing behavior)
    const pluginResult = pluginExecutors[plugin](parameters);
    
    // Create plugin message in database
    const pluginMessage = await createPluginMessage(
      conversationId, 
      userId, 
      plugin, 
      parameters, 
      pluginResult, 
      false
    );

    let response = {
      success: true,
      plugin,
      provider,
      conversationId,
      messageId: pluginMessage.messageId,
      messageSequence: pluginMessage.messageSequence,
      result: pluginResult,
      sendToModel,
      runAsync: false
    };

    // Send to model if requested
    if (sendToModel) {
      try {
        // Get conversation history if requested
        let conversationHistory = [];
        if (modelConfig.includeConversationHistory) {
          const historyMessages = await Message.find({
            conversationId,
            role: { $in: ['user', 'model'] },
            status: 'completed',
            isVisible: true
          })
          .sort({ messageSequence: 1 })
          .limit(modelConfig.maxHistoryMessages)
          .select('role content.text');

          conversationHistory = formatConversationHistory(historyMessages);
        }

        // Prepare messages for AI
        let messages = [...conversationHistory];
        
        // Add plugin result as context
        messages.push({
          role: 'user',
          parts: [{
            text: `Plugin "${plugin}" execution result: ${JSON.stringify(pluginResult, null, 2)}\n\nPlease analyze this result and provide insights or explanations.`
          }]
        });

        // Generate AI response
        const aiResponse = await ProviderManager.generateContent({
          provider: modelConfig.provider,
          contents: messages,
          config: {
            model: modelConfig.model,
            temperature: modelConfig.temperature,
            maxOutputTokens: modelConfig.maxOutputTokens,
            topP: modelConfig.topP,
            topK: modelConfig.topK,
            systemInstruction: modelConfig.systemInstruction || conversation.config?.rest?.systemInstruction,
            thinkingConfig: modelConfig.thinkingConfig
          }
        });

        if (aiResponse.success) {
          // Create AI response message
          const aiMessageSequence = conversation.getNextMessageSequence();
          await conversation.save();

          const aiMessage = new Message({
            messageId: uuidv4(),
            conversationId,
            userId,
            messageSequence: aiMessageSequence,
            messageType: 'rest',
            role: 'model',
            content: {
              text: aiResponse.text,
              thoughts: aiResponse.thoughts
            },
            config: {
              rest: modelConfig
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
                name: modelConfig.provider,
                model: modelConfig.model
              }
            }
          });

          await aiMessage.save();
          await conversation.incrementStats('rest', aiResponse.usageMetadata?.totalTokenCount || 0);

          response.aiResponse = {
            messageId: aiMessage.messageId,
            messageSequence: aiMessage.messageSequence,
            content: aiResponse.text,
            thoughts: aiResponse.thoughts,
            hasThoughtSignatures: aiResponse.hasThoughtSignatures || false,
            tokenUsage: {
              promptTokenCount: aiResponse.usageMetadata?.promptTokenCount || 0,
              candidatesTokenCount: aiResponse.usageMetadata?.candidatesTokenCount || 0,
              totalTokenCount: aiResponse.usageMetadata?.totalTokenCount || 0,
              thoughtsTokenCount: aiResponse.usageMetadata?.thoughtsTokenCount || 0
            },
            modelMetadata: {
              provider: modelConfig.provider,
              model: modelConfig.model,
              apiVersion: aiResponse.apiVersion || '2.5',
              temperature: modelConfig.temperature,
              maxOutputTokens: modelConfig.maxOutputTokens,
              topP: modelConfig.topP,
              topK: modelConfig.topK,
              systemInstruction: modelConfig.systemInstruction || conversation.config?.rest?.systemInstruction,
              thinkingConfig: modelConfig.thinkingConfig,
              finishReason: aiResponse.finishReason
            }
          };
        } else {
          response.aiResponse = {
            error: 'Failed to generate AI response',
            details: aiResponse.error
          };
        }
      } catch (aiError) {
        console.error('AI Response Error:', aiError);
        response.aiResponse = {
          error: 'AI processing failed',
          details: aiError.message
        };
      }
    }

    res.json(response);

  } catch (error) {
    console.error('Plugin execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Plugin execution failed',
      details: error.message
    });
  }
}));





export default router; 