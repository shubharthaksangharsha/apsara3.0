import { Conversation, Message } from '../models/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Live Conversation Service
 * Bridges REST API conversations with Live API sessions
 * Handles conversation context loading, message persistence, and mode switching
 */
export class LiveConversationService {
  /**
   * Link a Live session to an existing conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} sessionId - Live session ID
   * @param {Object} liveConfig - Live API configuration
   * @returns {Promise<Object>} Updated conversation
   */
  static async linkLiveSessionToConversation(conversationId, sessionId, liveConfig = {}) {
    try {
      const conversation = await Conversation.findOne({ conversationId });
      
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }

      // Update conversation with Live session information
      conversation.session.liveSessionId = sessionId;
      conversation.session.isLiveActive = true;
      conversation.session.lastActivity = new Date();
      conversation.session.connectionCount = (conversation.session.connectionCount || 0) + 1;
      
      // Set conversation type to hybrid if it was REST-only
      if (conversation.type === 'rest') {
        conversation.type = 'hybrid';
      }
      
      // Update Live configuration
      if (liveConfig.responseModalities) {
        conversation.config.live.responseModalities = liveConfig.responseModalities;
      }
      if (liveConfig.speechConfig) {
        conversation.config.live.speechConfig = liveConfig.speechConfig;
      }
      if (liveConfig.tools) {
        conversation.config.live.tools = liveConfig.tools;
      }
      if (liveConfig.sessionResumption) {
        conversation.config.live.sessionResumption = liveConfig.sessionResumption;
      }
      if (liveConfig.contextWindowCompression) {
        conversation.config.live.contextWindowCompression = liveConfig.contextWindowCompression;
      }

      await conversation.save();
      
      console.log(`🔗 Linked Live session ${sessionId} to conversation ${conversationId}`);
      
      return conversation;
    } catch (error) {
      console.error('Error linking Live session to conversation:', error);
      throw error;
    }
  }

  /**
   * Load REST conversation history into Live session context
   * Uses incremental updates as per Gemini Live API documentation
   * @param {string} conversationId - Conversation ID
   * @param {Object} liveSession - Live session object
   * @param {number} maxMessages - Maximum messages to load (default: 20)
   * @param {string} currentSessionId - Current session ID to exclude from context
   * @returns {Promise<Object>} Context loading result
   */
  static async loadConversationContextToLive(conversationId, liveSession, maxMessages = 20, currentSessionId = null) {
    try {
      console.log(`📚 Loading conversation context for ${conversationId} into Live session`);
      
      // Get conversation messages (excluding current Live session messages)
      console.log(`🔍 Searching for messages in conversation ${conversationId} (excluding session ${currentSessionId || 'none'})`);
      
      const queryFilter = {
        conversationId,
        status: 'completed'
      };
      
      // If we have a current session ID, exclude messages from this session
      if (currentSessionId) {
        queryFilter.$or = [
          { messageType: 'rest' },
          { 
            messageType: 'live', 
            'config.live.sessionId': { $ne: currentSessionId } 
          }
        ];
      }
      
      console.log(`🔍 Query filter:`, JSON.stringify(queryFilter, null, 2));
      
      const messages = await Message.find(queryFilter)
      .sort({ messageSequence: 1 })
      .limit(maxMessages)
      .lean();

      console.log(`🔍 Found ${messages.length} messages for context loading`);
      
      // Also check total messages in conversation for debugging
      const totalMessages = await Message.countDocuments({ conversationId });
      console.log(`🔍 Total messages in conversation: ${totalMessages}`);
      
      messages.forEach((msg, index) => {
        console.log(`  ${index + 1}. ${msg.role}: ${msg.content?.text || msg.liveContent?.generatedText || 'No text'} (${msg.messageType}, session: ${msg.config?.live?.sessionId || 'none'})`);
      });

      if (messages.length === 0) {
        console.log(`📭 No previous messages found for conversation ${conversationId}`);
        return { success: true, messagesLoaded: 0 };
      }

      // Convert messages to Live API format for incremental updates
      const conversationTurns = this.convertMessagesToLiveFormat(messages);
      
      if (conversationTurns.length === 0) {
        return { success: true, messagesLoaded: 0 };
      }

      console.log(`📤 Sending ${conversationTurns.length} conversation turns to Live session`);
      
      // Send conversation context using incremental updates as per Gemini Live docs
      // For context restoration, send all turns at once with turnComplete: false first,
      // then send an empty update with turnComplete: true to signal completion
      
      console.log(`📤 Sending ${conversationTurns.length} conversation turns via incremental updates`);
      
      // Validate and filter turns before sending
      const validTurns = [];
      for (const turn of conversationTurns) {
        try {
          if (!turn.role || !turn.parts || turn.parts.length === 0) {
            console.warn(`⚠️ Skipping invalid turn format: ${JSON.stringify(turn)}`);
            continue;
          }
          
          const validParts = [];
          for (const part of turn.parts) {
            // Validate different types of parts
            const hasText = part.text && typeof part.text === 'string' && part.text.trim().length > 0;
            const hasFileData = part.fileData && part.fileData.mimeType && part.fileData.fileUri;
            const hasInlineData = part.inlineData && part.inlineData.mimeType && part.inlineData.data;
            
            if (hasText || hasFileData || hasInlineData) {
              validParts.push(part);
            } else {
              console.warn(`⚠️ Skipping invalid part: ${JSON.stringify(part)}`);
            }
          }
          
          if (validParts.length > 0) {
            validTurns.push({ ...turn, parts: validParts });
          }
        } catch (error) {
          console.warn(`⚠️ Error validating turn, skipping: ${error.message}`);
        }
      }
      
      // Update conversationTurns to only include valid turns
      conversationTurns.splice(0, conversationTurns.length, ...validTurns);
      console.log(`✅ Validated ${validTurns.length} turns for context loading`);
      
      try {
        // Send all context turns with turnComplete: true (no need for separate completion signal)
        const contextPayload = { 
          turns: conversationTurns, 
          turnComplete: true
        };
        
        console.log(`📦 Sending context turns (turnComplete: true)`);
        console.log(`🔍 Context payload structure:`, JSON.stringify(contextPayload, null, 2).substring(0, 500) + '...');
        await liveSession.sendClientContent(contextPayload);
        console.log(`✅ Successfully sent ${conversationTurns.length} context turns`);
        
        // Note: Removed separate completion signal with empty turns array
        // as it was causing "Failed to parse client content" error
        
      } catch (error) {
        console.error(`❌ Error sending incremental updates:`, error);
        throw new Error(`Failed to send context via incremental updates: ${error.message}`);
      }

      console.log(`✅ Successfully loaded ${messages.length} messages (${conversationTurns.length} turns) into Live session context`);
      
      return { 
        success: true, 
        messagesLoaded: messages.length,
        turnsLoaded: conversationTurns.length 
      };
      
    } catch (error) {
      console.error('Error loading conversation context to Live session:', error);
      throw error;
    }
  }

  /**
   * Convert database messages to Live API format
   * @param {Array} messages - Array of message documents
   * @returns {Array} Array of Live API turns
   */
  static convertMessagesToLiveFormat(messages) {
    const turns = [];
    
    for (const message of messages) {
      // Skip empty messages
      if (!message.content?.text && !message.liveContent) {
        continue;
      }

      // ONLY include user messages in context - Gemini Live API rejects model messages in context
      if (message.role !== 'user') {
        console.log(`⚠️ Skipping ${message.role} message from context (Live API only accepts user messages)`);
        continue;
      }

      const turn = {
        role: 'user', // Always user for context loading
        parts: []
      };

      let textContent = '';

      // Add text content from REST messages
      if (message.content?.text && message.content.text.trim()) {
        textContent = message.content.text.trim();
      }

      // Add Live content if available (only for user messages since we filtered out model messages)
      if (message.liveContent) {
        // For user messages, use input transcription
        if (message.liveContent.inputTranscription?.text) {
          textContent = message.liveContent.inputTranscription.text.trim();
        }
      }

      // Validate text content (no truncation per user request)
      if (textContent) {
        // Ensure text is valid (no control characters, etc.)
        textContent = textContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        
        if (textContent.length > 0) {
          turn.parts.push({ text: textContent });
        }
      }

      // Add file attachments if present
      if (message.content?.files && Array.isArray(message.content.files) && message.content.files.length > 0) {
        for (const file of message.content.files) {
          if (file.fileData || file.inlineData) {
            // File already in Live API format
            turn.parts.push(file.fileData ? { fileData: file.fileData } : { inlineData: file.inlineData });
          } else if (file.url && file.mimeType) {
            // Convert URL-based file to fileData format (Note: This may not work for all URLs)
            console.log(`⚠️ Converting URL-based file to fileData format: ${file.originalName}`);
            turn.parts.push({
              fileData: {
                mimeType: file.mimeType,
                fileUri: file.url
              }
            });
          }
        }
      }

      // Only add turns with meaningful content
      if (turn.parts.length > 0) {
        turns.push(turn);
      }
    }

    console.log(`🔄 Converted ${messages.length} database messages to ${turns.length} user turns for Live API context`);
    return turns;
  }

  /**
   * Save Live API message to conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} sessionId - Live session ID
   * @param {Object} liveMessage - Live API message
   * @param {Object} audioFile - Audio file information (optional)
   * @returns {Promise<Object>} Saved message
   */
  static async saveLiveMessageToConversation(conversationId, sessionId, liveMessage, audioFile = null) {
    try {
      const conversation = await Conversation.findOne({ conversationId });
      
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }

      // Get next message sequence
      const messageSequence = conversation.getNextMessageSequence();
      await conversation.save();

      // Determine message role and content
      let role = 'user';
      let content = { text: '' };
      let liveContent = {};

      // Process different types of Live API messages
      console.log('🔍 Processing Live message structure:', JSON.stringify(liveMessage, null, 2));
      
      if (liveMessage.text) {
        // Text message
        content.text = liveMessage.text;
        role = liveMessage.role || 'user';
      }
      
      if (liveMessage.serverContent) {
        // AI response from Live API
        role = 'model';
        
        // Extract text content from modelTurn parts
        if (liveMessage.serverContent.modelTurn && liveMessage.serverContent.modelTurn.parts) {
          const parts = liveMessage.serverContent.modelTurn.parts || [];
          content.text = parts.map(part => part.text || '').filter(text => text).join(' ');
        }
        
        // Handle transcriptions - PRIORITIZE transcription text over audio placeholders
        if (liveMessage.serverContent.outputTranscription) {
          liveContent.outputTranscription = liveMessage.serverContent.outputTranscription;
          // Use transcription text as primary content (prioritize over placeholders)
          if (liveMessage.serverContent.outputTranscription.text) {
            content.text = liveMessage.serverContent.outputTranscription.text;
            console.log('✅ Using output transcription as content:', content.text);
          }
        }
        if (liveMessage.serverContent.inputTranscription) {
          liveContent.inputTranscription = liveMessage.serverContent.inputTranscription;
        }
        
        // Handle audio data in inline format - only use placeholder if no transcription exists
        if (liveMessage.serverContent.modelTurn && liveMessage.serverContent.modelTurn.parts) {
          for (const part of liveMessage.serverContent.modelTurn.parts) {
            if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('audio/')) {
              liveContent.audioData = {
                data: part.inlineData.data,
                mimeType: part.inlineData.mimeType
              };
              // Only use [Audio Response] placeholder if no transcription text exists
              // Check if we have meaningful transcription text (not just placeholders)
              const hasTranscriptionText = content.text && 
                                         content.text.trim().length > 0 && 
                                         content.text !== '[Audio Response]' && 
                                         content.text !== '[Live Response]';
              
              if (!hasTranscriptionText) {
                content.text = '[Audio Response]';
                console.log('⚠️ Using audio placeholder as no transcription available');
              } else {
                console.log('✅ Audio data stored, but keeping transcription text as content:', content.text);
              }
            }
          }
        }
      }
      
      // Handle direct data field (for streaming audio responses)
      if (liveMessage.data) {
        // Check if we have meaningful transcription text (not just placeholders)
        const hasTranscriptionText = content.text && 
                                   content.text.trim().length > 0 && 
                                   content.text !== '[Audio Response]' && 
                                   content.text !== '[Live Response]';
        
        if (!hasTranscriptionText) {
          content.text = '[Audio Response]';
        }
        
        liveContent.audioData = {
          data: liveMessage.data,
          mimeType: 'audio/pcm'
        };
      }
      
      // Ensure we have some content
      if (!content.text && !liveContent.audioData && !liveContent.outputTranscription) {
        console.warn('⚠️ Live message has no extractable content, using fallback');
        content.text = '[Live Response]';
      }

      // Handle audio data
      if (audioFile) {
        liveContent.audioData = {
          fileId: audioFile.fileId,
          url: audioFile.url,
          duration: audioFile.duration,
          mimeType: audioFile.mimeType
        };
      }

      // Handle realtime input metadata
      if (liveMessage.realtimeInput) {
        liveContent.realtimeInput = {
          type: liveMessage.realtimeInput.type || 'audio',
          streamMetadata: liveMessage.realtimeInput
        };
      }

      // Create message document
      const messageData = {
        messageId: uuidv4(),
        conversationId,
        userId: conversation.userId,
        messageSequence,
        messageType: 'live',
        role,
        content,
        liveContent,
        config: {
          live: {
            model: conversation.config.live.model || 'gemini-2.0-flash-live-001',
            sessionId,
            responseModalities: conversation.config.live.responseModalities || ['TEXT']
          }
        },
        status: 'completed',
        metadata: {
          timing: {
            requestTime: new Date()
          },
          provider: {
            name: 'google',
            sessionId
          }
        }
      };

      const message = new Message(messageData);
      await message.save();

      // Update conversation stats
      await conversation.incrementStats('live');
      conversation.session.lastActivity = new Date();
      await conversation.save();

      console.log(`💾 Saved Live message ${message.messageId} to conversation ${conversationId}`);
      
      return message;
      
    } catch (error) {
      console.error('Error saving Live message to conversation:', error);
      throw error;
    }
  }

  /**
   * Handle session resumption for a conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} resumptionHandle - Session resumption handle
   * @returns {Promise<Object>} Resumption result
   */
  static async handleSessionResumption(conversationId, resumptionHandle) {
    try {
      const conversation = await Conversation.findOne({ conversationId });
      
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }

      conversation.session.liveSessionHandle = resumptionHandle;
      conversation.session.lastResumeHandle = resumptionHandle;
      conversation.session.isLiveActive = true;
      conversation.session.lastActivity = new Date();
      
      await conversation.save();
      
      console.log(`🔄 Updated resumption handle for conversation ${conversationId}`);
      
      return { success: true, conversation };
      
    } catch (error) {
      console.error('Error handling session resumption:', error);
      throw error;
    }
  }

  /**
   * Switch conversation mode between REST and Live
   * @param {string} conversationId - Conversation ID
   * @param {string} mode - Target mode ('rest', 'live', 'hybrid')
   * @returns {Promise<Object>} Updated conversation
   */
  static async switchConversationMode(conversationId, mode) {
    try {
      const conversation = await Conversation.findOne({ conversationId });
      
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }

      const previousMode = conversation.type;
      conversation.type = mode;
      
      // If switching away from Live, end Live session
      if (mode === 'rest' && conversation.session.isLiveActive) {
        conversation.session.isLiveActive = false;
      }
      
      await conversation.save();
      
      console.log(`🔄 Switched conversation ${conversationId} from ${previousMode} to ${mode}`);
      
      return conversation;
      
    } catch (error) {
      console.error('Error switching conversation mode:', error);
      throw error;
    }
  }

  /**
   * Get conversation context summary for Live session
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>} Context summary
   */
  static async getConversationContextSummary(conversationId) {
    try {
      const conversation = await Conversation.findOne({ conversationId });
      
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }

      const messageStats = await Message.aggregate([
        { $match: { conversationId } },
        {
          $group: {
            _id: '$messageType',
            count: { $sum: 1 },
            lastMessage: { $last: '$content.text' }
          }
        }
      ]);

      const summary = {
        conversationId,
        title: conversation.title,
        type: conversation.type,
        totalMessages: conversation.stats.totalMessages,
        isLiveActive: conversation.session.isLiveActive,
        liveSessionId: conversation.session.liveSessionId,
        messageBreakdown: messageStats,
        lastActivity: conversation.session.lastActivity
      };

      return summary;
      
    } catch (error) {
      console.error('Error getting conversation context summary:', error);
      throw error;
    }
  }

  /**
   * Clean up inactive Live sessions
   * @param {number} timeoutMs - Timeout in milliseconds (default: 30 minutes)
   * @returns {Promise<number>} Number of cleaned up sessions
   */
  static async cleanupInactiveLiveSessions(timeoutMs = 30 * 60 * 1000) {
    try {
      const cutoffTime = new Date(Date.now() - timeoutMs);
      
      const result = await Conversation.updateMany(
        {
          'session.isLiveActive': true,
          'session.lastActivity': { $lt: cutoffTime }
        },
        {
          $set: {
            'session.isLiveActive': false,
            'session.liveSessionId': null
          }
        }
      );

      console.log(`🧹 Cleaned up ${result.modifiedCount} inactive Live sessions`);
      
      return result.modifiedCount;
      
    } catch (error) {
      console.error('Error cleaning up inactive Live sessions:', error);
      throw error;
    }
  }
}

export default LiveConversationService;