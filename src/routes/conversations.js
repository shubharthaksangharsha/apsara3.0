import express from 'express';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler } from '../middleware/errorHandler.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';

const router = express.Router();

// Validation schemas
const createConversationSchema = Joi.object({
  title: Joi.string().min(1).max(200).default('New Conversation'),
  userId: Joi.string().required(),
  config: Joi.object({
    model: Joi.string().default('gemini-2.5-flash'),
    systemInstruction: Joi.string(),
    temperature: Joi.number().min(0).max(2).default(0.7),
    maxOutputTokens: Joi.number().min(1).max(8192).default(2048)
  }).default({})
});

const updateConversationSchema = Joi.object({
  title: Joi.string().min(1).max(200),
  status: Joi.string().valid('active', 'paused', 'completed', 'archived'),
  config: Joi.object({
    model: Joi.string(),
    systemInstruction: Joi.string(),
    temperature: Joi.number().min(0).max(2),
    maxOutputTokens: Joi.number().min(1).max(8192)
  })
});

const renameConversationSchema = Joi.object({
  title: Joi.string().min(1).max(200).required()
});

const saveMessageSchema = Joi.object({
  conversationId: Joi.string().required(),
  content: Joi.string().required(),
  role: Joi.string().valid('user', 'assistant').required(),
  thoughts: Joi.string().optional(),
  model: Joi.string().required(),
  config: Joi.object().default({}),
  usageMetadata: Joi.object().optional()
});

/**
 * @route POST /api/conversations
 * @desc Create a new conversation
 * @access Public
 */
router.post('/', asyncHandler(async (req, res) => {
  const { error, value } = createConversationSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { title, userId, config } = value;
  const conversationId = uuidv4();

  const conversation = new Conversation({
    conversationId,
    userId,
    title,
    config: {
      rest: config
    },
    createdAt: new Date(),
    updatedAt: new Date()
  });

  await conversation.save();

  res.status(201).json({
    success: true,
    data: {
      conversationId: conversation.conversationId,
      title: conversation.title,
      userId: conversation.userId,
      status: conversation.status,
      config: conversation.config,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    }
  });
}));

/**
 * @route GET /api/conversations/:userId
 * @desc Get all conversations for a user
 * @access Public
 */
router.get('/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { limit = 20, offset = 0, status } = req.query;

  const filter = { userId };
  if (status) {
    filter.status = status;
  }

  const conversations = await Conversation
    .find(filter)
    .sort({ 
      isPinned: -1,        // Pinned conversations first
      pinnedAt: -1,        // Most recently pinned first
      updatedAt: -1        // Then by last updated
    })
    .limit(parseInt(limit))
    .skip(parseInt(offset))
    .select('conversationId title status isPinned pinnedAt createdAt updatedAt stats');

  res.json({
    success: true,
    data: conversations,
    pagination: {
      limit: parseInt(limit),
      offset: parseInt(offset),
      total: await Conversation.countDocuments(filter)
    }
  });
}));

/**
 * @route GET /api/conversations/:conversationId/messages
 * @desc Get messages for a conversation
 * @access Public
 */
router.get('/:conversationId/messages', asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  const messages = await Message
    .find({ conversationId })
    .sort({ createdAt: 1 })
    .limit(parseInt(limit))
    .skip(parseInt(offset))
    .select('messageId content role thoughts timestamp createdAt');

  res.json({
    success: true,
    data: messages,
    pagination: {
      limit: parseInt(limit),
      offset: parseInt(offset),
      total: await Message.countDocuments({ conversationId })
    }
  });
}));

/**
 * @route POST /api/conversations/messages
 * @desc Save a message to a conversation
 * @access Public
 */
router.post('/messages', asyncHandler(async (req, res) => {
  const { error, value } = saveMessageSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { conversationId, content, role, thoughts, model, config, usageMetadata } = value;

  // Check if conversation exists
  const conversation = await Conversation.findOne({ conversationId });
  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: { message: 'Conversation not found' }
    });
  }

  const messageId = uuidv4();
  const message = new Message({
    messageId,
    conversationId,
    content: {
      text: content,
      thoughts: thoughts || null
    },
    role,
    timestamp: Date.now(),
    config: {
      rest: {
        model,
        ...config
      }
    },
    metadata: {
      provider: {
        name: 'google',
        model: model
      },
      ...(usageMetadata && { tokens: usageMetadata })
    },
    createdAt: new Date()
  });

  await message.save();

  // Update conversation stats
  conversation.stats.messageCount = (conversation.stats.messageCount || 0) + 1;
  conversation.updatedAt = new Date();
  
  // Update title if this is the first user message and title is default
  if (conversation.title === 'New Conversation' && role === 'user') {
    // Generate title from first 50 characters of message
    conversation.title = content.length > 50 ? content.substring(0, 47) + '...' : content;
  }
  
  await conversation.save();

  res.status(201).json({
    success: true,
    data: {
      messageId: message.messageId,
      conversationId: message.conversationId,
      content: message.content,
      role: message.role,
      timestamp: message.timestamp,
      createdAt: message.createdAt
    }
  });
}));

/**
 * @route PUT /api/conversations/:conversationId
 * @desc Update conversation details
 * @access Public
 */
router.put('/:conversationId', asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { error, value } = updateConversationSchema.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const conversation = await Conversation.findOneAndUpdate(
    { conversationId },
    {
      ...value,
      updatedAt: new Date()
    },
    { new: true }
  );

  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: { message: 'Conversation not found' }
    });
  }

  res.json({
    success: true,
    data: conversation
  });
}));

/**
 * @route PUT /api/conversations/:conversationId/rename
 * @desc Rename a conversation
 * @access Public
 */
router.put('/:conversationId/rename', asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { error, value } = renameConversationSchema.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      success: false,
      error: { message: error.details[0].message }
    });
  }

  const { title } = value;

  const conversation = await Conversation.findOneAndUpdate(
    { conversationId },
    {
      title,
      updatedAt: new Date()
    },
    { new: true }
  );

  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: { message: 'Conversation not found' }
    });
  }

  res.json({
    success: true,
    message: 'Conversation renamed successfully',
    data: {
      conversationId: conversation.conversationId,
      title: conversation.title,
      updatedAt: conversation.updatedAt
    }
  });
}));

/**
 * @route PUT /api/conversations/:conversationId/pin
 * @desc Pin/unpin a conversation
 * @access Public
 */
router.put('/:conversationId/pin', asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { pin = true } = req.body; // Default to pin=true, can pass pin=false to unpin

  const conversation = await Conversation.findOne({ conversationId });
  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: { message: 'Conversation not found' }
    });
  }

  let updatedConversation;
  if (pin && !conversation.isPinned) {
    updatedConversation = await conversation.pin();
  } else if (!pin && conversation.isPinned) {
    updatedConversation = await conversation.unpin();
  } else {
    updatedConversation = conversation;
  }

  const action = pin ? 'pinned' : 'unpinned';
  const message = `Conversation ${action} successfully`;

  res.json({
    success: true,
    message,
    data: {
      conversationId: updatedConversation.conversationId,
      title: updatedConversation.title,
      isPinned: updatedConversation.isPinned,
      pinnedAt: updatedConversation.pinnedAt,
      updatedAt: updatedConversation.updatedAt
    }
  });
}));

/**
 * @route DELETE /api/conversations/:conversationId
 * @desc Delete a conversation and all its messages
 * @access Public
 */
router.delete('/:conversationId', asyncHandler(async (req, res) => {
  const { conversationId } = req.params;

  const conversation = await Conversation.findOneAndDelete({ conversationId });
  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: { message: 'Conversation not found' }
    });
  }

  // Delete all messages in this conversation
  await Message.deleteMany({ conversationId });

  res.json({
    success: true,
    message: 'Conversation and messages deleted successfully'
  });
}));

export default router;