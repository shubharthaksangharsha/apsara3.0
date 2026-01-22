import express from 'express';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler } from '../middleware/errorHandler.js';
import { conversationWriteRateLimiter, messageRateLimiter } from '../middleware/rateLimiter.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import embeddingService from '../services/embeddingService.js';

const router = express.Router();

// Validation schemas
const createConversationSchema = Joi.object({
  title: Joi.string().min(1).max(200).default('New Conversation'),
  userId: Joi.string().required(),
  config: Joi.object({
    model: Joi.string().default('gemini-2.5-flash'),
    systemInstruction: Joi.string(),
    temperature: Joi.number().min(0).max(2).default(0.7),
    maxOutputTokens: Joi.number().min(1).max(65536).default(8192) // Updated to 65536
  }).default({})
});

const updateConversationSchema = Joi.object({
  title: Joi.string().min(1).max(200),
  status: Joi.string().valid('active', 'paused', 'completed', 'archived'),
  config: Joi.object({
    model: Joi.string(),
    systemInstruction: Joi.string(),
    temperature: Joi.number().min(0).max(2),
    maxOutputTokens: Joi.number().min(1).max(65536) // Updated to 65536
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
 * @access Public (with rate limiting)
 */
router.post('/', conversationWriteRateLimiter, asyncHandler(async (req, res) => {
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
    .select('messageId content role thoughts timestamp createdAt files');

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
 * @access Public (with rate limiting)
 */
router.post('/messages', messageRateLimiter, asyncHandler(async (req, res) => {
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

  // Update embedding asynchronously (don't block the response)
  // Only update every 5 messages to reduce API calls
  if (conversation.stats.messageCount % 5 === 0 || conversation.stats.messageCount <= 2) {
    setImmediate(async () => {
      try {
        const messages = await Message.find({ conversationId })
          .sort({ createdAt: -1 })
          .limit(10);
        
        const searchableContent = embeddingService.createSearchableContent(conversation, messages);
        if (searchableContent && searchableContent.trim().length > 0) {
          const embedding = await embeddingService.generateDocumentEmbedding(searchableContent);
          await Conversation.updateOne(
            { conversationId },
            { embedding, embeddingUpdatedAt: new Date() }
          );
          console.log(`✅ Auto-updated embedding for conversation: ${conversationId}`);
        }
      } catch (err) {
        console.error(`⚠️ Failed to update embedding for ${conversationId}:`, err.message);
      }
    });
  }

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
 * @access Public (with rate limiting)
 */
router.put('/:conversationId', conversationWriteRateLimiter, asyncHandler(async (req, res) => {
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
 * @access Public (with rate limiting)
 */
router.put('/:conversationId/rename', conversationWriteRateLimiter, asyncHandler(async (req, res) => {
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
 * @access Public (with rate limiting)
 */
router.put('/:conversationId/pin', conversationWriteRateLimiter, asyncHandler(async (req, res) => {
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
 * @route DELETE /api/conversations/user/:userId/all
 * @desc Delete all conversations and messages for a user
 * @access Public (with rate limiting)
 */
router.delete('/user/:userId/all', conversationWriteRateLimiter, asyncHandler(async (req, res) => {
  const { userId } = req.params;

  console.log(`🗑️ Deleting all conversations for user: ${userId}`);

  // Get count of conversations and messages for logging
  const conversationCount = await Conversation.countDocuments({ userId });
  const messageCount = await Message.countDocuments({ userId });

  console.log(`📊 Found ${conversationCount} conversations and ${messageCount} messages to delete`);

  // Delete all conversations and messages for this user
  await Promise.all([
    Conversation.deleteMany({ userId }),
    Message.deleteMany({ userId })
  ]);

  console.log(`✅ All conversations deleted successfully for user: ${userId}`);
  console.log(`📊 Deleted: ${conversationCount} conversations + ${messageCount} messages`);

  res.json({
    success: true,
    message: 'All conversations and messages deleted successfully',
    data: {
      deletedConversations: conversationCount,
      deletedMessages: messageCount
    }
  });
}));

/**
 * @route DELETE /api/conversations/:conversationId
 * @desc Delete a conversation and all its messages
 * @access Public (with rate limiting)
 */
router.delete('/:conversationId', conversationWriteRateLimiter, asyncHandler(async (req, res) => {
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

/**
 * @route POST /api/conversations/search
 * @desc Semantic search conversations for a user
 * @access Public
 */
router.post('/search', asyncHandler(async (req, res) => {
  const { userId, query, limit = 20, exactMatch = true } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: { message: 'userId is required' }
    });
  }

  if (!query || query.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: { message: 'Search query is required' }
    });
  }

  try {
    console.log(`🔍 Semantic search for user: ${userId}, query: "${query}", exactMatch: ${exactMatch}`);
    
    // Generate embedding for the search query
    const queryEmbedding = await embeddingService.generateQueryEmbedding(query);
    
    // Use MongoDB Atlas Vector Search aggregation pipeline
    // Get more results than requested if we need to filter by exact match
    const searchLimit = exactMatch ? Math.min(limit * 5, 100) : parseInt(limit);
    
    const conversations = await Conversation.aggregate([
      {
        $vectorSearch: {
          index: 'conversation_embedding_index',
          path: 'embedding',
          queryVector: queryEmbedding,
          numCandidates: Math.min(searchLimit * 10, 100),
          limit: searchLimit,
          filter: {
            userId: userId
          }
        }
      },
      {
        $project: {
          conversationId: 1,
          title: 1,
          status: 1,
          isPinned: 1,
          pinnedAt: 1,
          createdAt: 1,
          updatedAt: 1,
          stats: 1,
          score: { $meta: 'vectorSearchScore' }
        }
      }
    ]);

    console.log(`✅ Vector search returned ${conversations.length} semantically similar conversations`);

    // If exactMatch is enabled, filter to only conversations that contain the search term
    let filteredConversations = conversations;
    if (exactMatch && conversations.length > 0) {
      // Get conversation IDs
      const conversationIds = conversations.map(c => c.conversationId);
      
      // Find which conversations have messages containing the search query
      const matchingMessages = await Message.aggregate([
        {
          $match: {
            conversationId: { $in: conversationIds },
            'content.text': { $regex: query, $options: 'i' }
          }
        },
        {
          $group: {
            _id: '$conversationId',
            matchCount: { $sum: 1 }
          }
        }
      ]);
      
      const conversationsWithMatches = new Set(matchingMessages.map(m => m._id));
      console.log(`📝 Found ${conversationsWithMatches.size} conversations with actual text matches`);
      
      // Filter to only keep conversations that have actual text matches
      filteredConversations = conversations.filter(c => conversationsWithMatches.has(c.conversationId));
      
      // Limit to requested number
      filteredConversations = filteredConversations.slice(0, parseInt(limit));
      
      console.log(`✅ Returning ${filteredConversations.length} conversations with exact matches`);
    }

    res.json({
      success: true,
      data: filteredConversations,
      pagination: {
        limit: parseInt(limit),
        total: filteredConversations.length
      }
    });
  } catch (error) {
    console.error('❌ Semantic search error:', error);
    
    // Fallback to text-based search if vector search fails
    // This handles cases where vector index isn't set up yet
    if (error.message?.includes('$vectorSearch') || error.code === 40324) {
      console.log('⚠️ Vector search not available, falling back to text search');
      
      // For text fallback, search in both conversation titles AND message content
      const conversationsByTitle = await Conversation.find({
        userId,
        title: { $regex: query, $options: 'i' }
      })
      .sort({ isPinned: -1, pinnedAt: -1, updatedAt: -1 })
      .limit(parseInt(limit))
      .select('conversationId title status isPinned pinnedAt createdAt updatedAt stats');
      
      // Also search messages
      const matchingMessages = await Message.aggregate([
        {
          $match: {
            'content.text': { $regex: query, $options: 'i' }
          }
        },
        {
          $group: {
            _id: '$conversationId'
          }
        }
      ]);
      
      const messageConversationIds = matchingMessages.map(m => m._id);
      const titleConversationIds = conversationsByTitle.map(c => c.conversationId);
      const allMatchingIds = [...new Set([...titleConversationIds, ...messageConversationIds])];
      
      const allConversations = await Conversation.find({
        userId,
        conversationId: { $in: allMatchingIds }
      })
      .sort({ isPinned: -1, pinnedAt: -1, updatedAt: -1 })
      .limit(parseInt(limit))
      .select('conversationId title status isPinned pinnedAt createdAt updatedAt stats');

      return res.json({
        success: true,
        data: allConversations,
        pagination: {
          limit: parseInt(limit),
          total: allConversations.length
        },
        fallback: true
      });
    }
    
    throw error;
  }
}));

/**
 * @route POST /api/conversations/:conversationId/embedding
 * @desc Generate/update embedding for a conversation
 * @access Public
 */
router.post('/:conversationId/embedding', asyncHandler(async (req, res) => {
  const { conversationId } = req.params;

  const conversation = await Conversation.findOne({ conversationId });
  if (!conversation) {
    return res.status(404).json({
      success: false,
      error: { message: 'Conversation not found' }
    });
  }

  // Get recent messages for this conversation
  const messages = await Message.find({ conversationId })
    .sort({ createdAt: -1 })
    .limit(10);

  // Create searchable content
  const searchableContent = embeddingService.createSearchableContent(conversation, messages);
  
  if (!searchableContent || searchableContent.trim().length === 0) {
    return res.json({
      success: true,
      message: 'No content to embed yet',
      data: { conversationId }
    });
  }

  // Generate embedding
  const embedding = await embeddingService.generateDocumentEmbedding(searchableContent);

  // Update conversation with embedding
  conversation.embedding = embedding;
  conversation.embeddingUpdatedAt = new Date();
  await conversation.save();

  console.log(`✅ Updated embedding for conversation: ${conversationId}`);

  res.json({
    success: true,
    message: 'Embedding updated successfully',
    data: {
      conversationId,
      embeddingDimensions: embedding.length,
      embeddingUpdatedAt: conversation.embeddingUpdatedAt
    }
  });
}));

/**
 * @route POST /api/conversations/embeddings/batch
 * @desc Generate embeddings for all conversations of a user (batch operation)
 * @access Public
 */
router.post('/embeddings/batch', asyncHandler(async (req, res) => {
  const { userId, limit = 50 } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: { message: 'userId is required' }
    });
  }

  console.log(`🔄 Batch embedding generation for user: ${userId}`);

  // Find conversations without embeddings or with stale embeddings
  const conversations = await Conversation.find({
    userId,
    $or: [
      { embedding: { $exists: false } },
      { embedding: { $size: 0 } },
      { embeddingUpdatedAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } // Older than 7 days
    ]
  }).limit(parseInt(limit));

  console.log(`📊 Found ${conversations.length} conversations needing embeddings`);

  let updated = 0;
  let errors = 0;

  for (const conversation of conversations) {
    try {
      const messages = await Message.find({ conversationId: conversation.conversationId })
        .sort({ createdAt: -1 })
        .limit(10);

      const searchableContent = embeddingService.createSearchableContent(conversation, messages);
      
      if (searchableContent && searchableContent.trim().length > 0) {
        const embedding = await embeddingService.generateDocumentEmbedding(searchableContent);
        conversation.embedding = embedding;
        conversation.embeddingUpdatedAt = new Date();
        await conversation.save();
        updated++;
      }
    } catch (error) {
      console.error(`❌ Error embedding conversation ${conversation.conversationId}:`, error.message);
      errors++;
    }
  }

  console.log(`✅ Batch embedding complete: ${updated} updated, ${errors} errors`);

  res.json({
    success: true,
    message: 'Batch embedding generation complete',
    data: {
      processed: conversations.length,
      updated,
      errors
    }
  });
}));

export default router;