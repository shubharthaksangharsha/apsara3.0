import { User, Conversation, Message, File } from '../../models/index.js';
import { v4 as uuidv4 } from 'uuid';

class ConversationService {
  /**
   * Create a new conversation for a user
   */
  static async createConversation(userId, type = 'rest', config = {}) {
    try {
      // For Live sessions, userId is actually the user's MongoDB _id from JWT token
      // For REST sessions, userId might be a custom field
      let user;
      
      if (type === 'live') {
        // For Live sessions, userId is the MongoDB _id from JWT authentication
        user = await User.findById(userId);
        if (!user) {
          throw new Error(`User ${userId} not found. Live sessions require authenticated users.`);
        }
      } else {
        // For REST sessions, try legacy userId field first, then _id
        user = await User.findOne({ userId }) || await User.findById(userId);
        if (!user) {
          // Create user if needed (legacy behavior for REST)
          user = new User({ userId });
          await user.save();
        }
      }

      // Check if user can create more sessions
      if (!user.canCreateSession()) {
        throw new Error('Session limit reached for user');
      }

      const conversationId = uuidv4();
      
      const conversation = new Conversation({
        conversationId,
        userId,
        type,
        config: {
          rest: type === 'rest' || type === 'hybrid' ? {
            model: config.model || user.preferences.defaultModel,
            temperature: config.temperature || user.preferences.defaultTemperature,
            maxOutputTokens: config.maxOutputTokens || user.preferences.defaultMaxTokens,
            systemInstruction: config.systemInstruction,
            tools: config.tools || []
          } : undefined,
          live: type === 'live' || type === 'hybrid' ? {
            model: config.liveModel || 'gemini-2.5-flash-native-audio-preview-09-2025',
            responseModalities: config.responseModalities || ['TEXT'],
            speechConfig: config.speechConfig,
            tools: config.liveTools || []
          } : undefined
        }
      });

      await conversation.save();
      
      // Update user stats
      user.usage.totalSessions += 1;
      await user.save();

      return conversation;
    } catch (error) {
      throw new Error(`Failed to create conversation: ${error.message}`);
    }
  }

  /**
   * Get conversation by ID with user verification
   */
  static async getConversation(conversationId, userId) {
    try {
      const conversation = await Conversation.findOne({ conversationId, userId });
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      return conversation;
    } catch (error) {
      throw new Error(`Failed to get conversation: ${error.message}`);
    }
  }

  /**
   * Get user's conversations
   */
  static async getUserConversations(userId, type = null, limit = 50) {
    try {
      const query = { userId, status: { $in: ['active', 'paused'] } };
      if (type) query.type = type;
      
      return await Conversation.find(query)
        .sort({ updatedAt: -1 })
        .limit(limit);
    } catch (error) {
      throw new Error(`Failed to get user conversations: ${error.message}`);
    }
  }

  /**
   * Transition conversation from REST to Live API
   */
  static async transitionToLive(conversationId, userId, liveConfig = {}) {
    try {
      const conversation = await this.getConversation(conversationId, userId);
      
      if (!conversation.canTransitionToLive()) {
        throw new Error('Conversation cannot transition to Live API');
      }

      // Get recent messages for context
      const recentMessages = await Message.findByConversation(conversationId, 10);
      
      // Prepare transition context
      await conversation.prepareTransitionContext(recentMessages);
      
      // Update conversation type and config
      conversation.type = conversation.type === 'rest' ? 'hybrid' : conversation.type;
      conversation.config.live = {
        model: liveConfig.model || 'gemini-2.5-flash-native-audio-preview-09-2025',
        responseModalities: liveConfig.responseModalities || ['TEXT'],
        speechConfig: liveConfig.speechConfig,
        sessionResumption: {},
        contextWindowCompression: { slidingWindow: {} },
        tools: liveConfig.tools || []
      };

      await conversation.save();
      return conversation;
    } catch (error) {
      throw new Error(`Failed to transition to Live API: ${error.message}`);
    }
  }

  /**
   * Transition conversation from Live to REST API
   */
  static async transitionToRest(conversationId, userId, restConfig = {}) {
    try {
      const conversation = await this.getConversation(conversationId, userId);
      
      if (!conversation.canTransitionToRest()) {
        throw new Error('Conversation cannot transition to REST API');
      }

      // End live session if active
      if (conversation.session.isLiveActive) {
        await conversation.endLiveSession();
      }

      // Update conversation type and config
      conversation.type = conversation.type === 'live' ? 'hybrid' : conversation.type;
      conversation.config.rest = {
        model: restConfig.model || 'gemini-2.5-flash',
        temperature: restConfig.temperature || 0.7,
        maxOutputTokens: restConfig.maxOutputTokens || 2048,
        systemInstruction: restConfig.systemInstruction,
        tools: restConfig.tools || []
      };

      await conversation.save();
      return conversation;
    } catch (error) {
      throw new Error(`Failed to transition to REST API: ${error.message}`);
    }
  }

  /**
   * Update live session information
   */
  static async updateLiveSession(conversationId, userId, sessionId, handle = null) {
    try {
      const conversation = await this.getConversation(conversationId, userId);
      await conversation.updateLiveSession(sessionId, handle);
      return conversation;
    } catch (error) {
      throw new Error(`Failed to update live session: ${error.message}`);
    }
  }

  /**
   * End live session
   */
  static async endLiveSession(conversationId, userId) {
    try {
      const conversation = await this.getConversation(conversationId, userId);
      await conversation.endLiveSession();
      return conversation;
    } catch (error) {
      throw new Error(`Failed to end live session: ${error.message}`);
    }
  }

  /**
   * Get conversation messages
   */
  static async getConversationMessages(conversationId, userId, limit = 50) {
    try {
      // Verify user has access to conversation
      await this.getConversation(conversationId, userId);
      
      return await Message.findByConversation(conversationId, limit);
    } catch (error) {
      throw new Error(`Failed to get conversation messages: ${error.message}`);
    }
  }

  /**
   * Add message to conversation
   */
  static async addMessage(conversationId, userId, messageData) {
    try {
      const conversation = await this.getConversation(conversationId, userId);
      const user = await User.findOne({ userId }) || await User.findById(userId);
      
      const messageId = uuidv4();
      
      const message = new Message({
        messageId,
        conversationId,
        userId,
        messageType: messageData.messageType,
        role: messageData.role,
        content: messageData.content,
        config: messageData.config,
        functionCall: messageData.functionCall,
        metadata: {
          ...messageData.metadata,
          timing: {
            requestTime: new Date(),
            ...messageData.metadata?.timing
          }
        },
        status: messageData.status || 'pending'
      });

      await message.save();

      // Update conversation and user stats
      await conversation.incrementStats(messageData.messageType, messageData.metadata?.tokens?.total || 0);
      if (user && messageData.metadata?.tokens?.total) {
        await user.incrementUsage(messageData.metadata.tokens.total);
      }

      return message;
    } catch (error) {
      throw new Error(`Failed to add message: ${error.message}`);
    }
  }

  /**
   * Update conversation title based on first message
   */
  static async updateConversationTitle(conversationId, userId) {
    try {
      const conversation = await this.getConversation(conversationId, userId);
      const firstMessage = await Message.findOne({ 
        conversationId, 
        role: 'user' 
      }).sort({ createdAt: 1 });

      if (firstMessage && firstMessage.content.text) {
        const title = firstMessage.content.text.length > 50 ? 
          firstMessage.content.text.substring(0, 50) + '...' : 
          firstMessage.content.text;
        
        conversation.title = title;
        await conversation.save();
      }

      return conversation;
    } catch (error) {
      throw new Error(`Failed to update conversation title: ${error.message}`);
    }
  }

  /**
   * Archive conversation
   */
  static async archiveConversation(conversationId, userId) {
    try {
      const conversation = await this.getConversation(conversationId, userId);
      
      // End live session if active
      if (conversation.session.isLiveActive) {
        await conversation.endLiveSession();
      }
      
      conversation.status = 'archived';
      await conversation.save();
      
      return conversation;
    } catch (error) {
      throw new Error(`Failed to archive conversation: ${error.message}`);
    }
  }

  /**
   * Get user statistics
   */
  static async getUserStats(userId) {
    try {
      const user = await User.findOne({ userId }) || await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const conversations = await Conversation.find({ userId });
      const messages = await Message.find({ userId });
      
      const tokenUsage = await Message.getTokenUsageByUser(userId);
      
      return {
        user: {
          totalTokens: user.usage.totalTokens,
          totalSessions: user.usage.totalSessions,
          totalMessages: user.usage.totalMessages,
          lastActive: user.usage.lastActive,
          subscription: user.subscription
        },
        conversations: {
          total: conversations.length,
          active: conversations.filter(c => c.status === 'active').length,
          rest: conversations.filter(c => c.type === 'rest').length,
          live: conversations.filter(c => c.type === 'live').length,
          hybrid: conversations.filter(c => c.type === 'hybrid').length
        },
        messages: {
          total: messages.length,
          rest: messages.filter(m => m.messageType === 'rest').length,
          live: messages.filter(m => m.messageType === 'live').length
        },
        tokenUsage: tokenUsage[0] || {}
      };
    } catch (error) {
      throw new Error(`Failed to get user stats: ${error.message}`);
    }
  }
}

export default ConversationService; 