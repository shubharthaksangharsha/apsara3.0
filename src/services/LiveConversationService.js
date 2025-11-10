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
   * Accumulate and merge transcription fragments from buffered messages
   * @param {Array} bufferedMessages - Array of buffered message objects
   * @returns {Array} Array of merged messages ready to save
   */
  static accumulateTranscriptionFragments(bufferedMessages) {
    const mergedMessages = [];
    let currentInputTranscription = null;
    let currentOutputTranscription = null;
    let currentUserText = null;
    let currentModelText = null;
    let accumulatedAudioData = [];
    
    for (const buffered of bufferedMessages) {
      const msg = buffered.response;
      
      // Accumulate input transcription fragments
      if (msg.serverContent?.inputTranscription?.text) {
        const fragment = msg.serverContent.inputTranscription.text.trim();
        if (fragment.length > 0) {
          if (!currentInputTranscription) {
            currentInputTranscription = {
              text: fragment,
              original: msg.serverContent.inputTranscription
            };
          } else {
            // Check if this is an expansion (new text contains/extends old text) or continuation
            const currentText = currentInputTranscription.text;
            
            if (fragment.startsWith(currentText)) {
              // Expansion - new text is longer version of current text
              currentInputTranscription.text = fragment;
              currentInputTranscription.original = msg.serverContent.inputTranscription;
            } else if (currentText.endsWith(' ') || 
                      currentText.endsWith('.') || 
                      currentText.endsWith('!') || 
                      currentText.endsWith('?') ||
                      currentText.endsWith(',') ||
                      currentText.endsWith(';') ||
                      currentText.endsWith(':')) {
              // Previous text ended with punctuation/space - append directly
              currentInputTranscription.text += fragment;
            } else if (fragment.length < 15 && !fragment.includes(' ')) {
              // Short fragment without spaces - likely continuation of a word
              // Check if current text ends with a letter and fragment starts with a letter
              const currentEndsWithLetter = /[a-zA-Z]$/.test(currentText);
              const fragmentStartsWithLetter = /^[a-zA-Z]/.test(fragment);
              
              if (currentEndsWithLetter && fragmentStartsWithLetter) {
                // Both are letters - likely word continuation, append directly
                currentInputTranscription.text += fragment;
              } else {
                // Add space for clarity
                currentInputTranscription.text += ' ' + fragment;
              }
            } else {
              // Longer fragment or contains spaces - add space before
              currentInputTranscription.text += ' ' + fragment;
            }
          }
        }
      }
      
      // Accumulate output transcription fragments
      if (msg.serverContent?.outputTranscription?.text) {
        const fragment = msg.serverContent.outputTranscription.text.trim();
        if (fragment.length > 0) {
          if (!currentOutputTranscription) {
            currentOutputTranscription = {
              text: fragment,
              original: msg.serverContent.outputTranscription
            };
          } else {
            // Check if this is an expansion (new text contains/extends old text)
            const currentText = currentOutputTranscription.text;
            
            if (fragment.startsWith(currentText)) {
              // Expansion - new text is longer version of current text
              currentOutputTranscription.text = fragment;
              currentOutputTranscription.original = msg.serverContent.outputTranscription;
            } else if (currentText.endsWith(' ') || 
                      currentText.endsWith('.') || 
                      currentText.endsWith('!') || 
                      currentText.endsWith('?') ||
                      currentText.endsWith(',') ||
                      currentText.endsWith(';') ||
                      currentText.endsWith(':')) {
              // Previous text ended with punctuation/space - append directly
              currentOutputTranscription.text += fragment;
            } else if (fragment.length < 15 && !fragment.includes(' ')) {
              // Short fragment without spaces - likely continuation of a word
              // Check if current text ends with a letter and fragment starts with a letter
              const currentEndsWithLetter = /[a-zA-Z]$/.test(currentText);
              const fragmentStartsWithLetter = /^[a-zA-Z]/.test(fragment);
              
              if (currentEndsWithLetter && fragmentStartsWithLetter) {
                // Both are letters - likely word continuation, append directly
                currentOutputTranscription.text += fragment;
              } else {
                // Add space for clarity
                currentOutputTranscription.text += ' ' + fragment;
              }
            } else {
              // Longer fragment or contains spaces - add space before
              currentOutputTranscription.text += ' ' + fragment;
            }
          }
        }
      }
      
      // Accumulate text-only messages
      if (msg.text && !msg.serverContent) {
        if (msg.role === 'user') {
          if (!currentUserText) {
            currentUserText = msg.text;
          } else {
            currentUserText += ' ' + msg.text;
          }
        } else {
          if (!currentModelText) {
            currentModelText = msg.text;
          } else {
            currentModelText += ' ' + msg.text;
          }
        }
      }
      
      // Collect audio data (keep all for merging)
      if (msg.data || (msg.serverContent?.modelTurn?.parts)) {
        if (msg.data) {
          accumulatedAudioData.push({
            data: msg.data,
            mimeType: 'audio/pcm'
          });
        }
        if (msg.serverContent?.modelTurn?.parts) {
          for (const part of msg.serverContent.modelTurn.parts) {
            if (part.inlineData?.mimeType?.startsWith('audio/')) {
              accumulatedAudioData.push({
                data: part.inlineData.data,
                mimeType: part.inlineData.mimeType
              });
            }
          }
        }
      }
      
      // Check for turnComplete or generationComplete - save accumulated transcriptions
      if (msg.serverContent?.turnComplete || msg.serverContent?.generationComplete) {
        // Save accumulated input transcription
        if (currentInputTranscription) {
          // Normalize text: remove extra spaces, clean up
          const normalizedText = currentInputTranscription.text
            .replace(/\s+/g, ' ') // Multiple spaces to single space
            .replace(/\s+([.,!?;:])/g, '$1') // Remove space before punctuation
            .trim();
          
          mergedMessages.push({
            conversationId: buffered.conversationId,
            sessionId: buffered.sessionId,
            response: {
              serverContent: {
                inputTranscription: {
                  text: normalizedText,
                  ...currentInputTranscription.original
                }
              }
            }
          });
          currentInputTranscription = null;
        }
        
        // Save accumulated output transcription
        if (currentOutputTranscription) {
          // Normalize text: remove extra spaces, clean up
          const normalizedText = currentOutputTranscription.text
            .replace(/\s+/g, ' ') // Multiple spaces to single space
            .replace(/\s+([.,!?;:])/g, '$1') // Remove space before punctuation
            .trim();
          
          const mergedMsg = {
            conversationId: buffered.conversationId,
            sessionId: buffered.sessionId,
            response: {
              serverContent: {
                outputTranscription: {
                  text: normalizedText,
                  ...currentOutputTranscription.original
                }
              }
            }
          };
          
          // Add audio data if available
          if (accumulatedAudioData.length > 0) {
            mergedMsg.response.serverContent.modelTurn = {
              parts: accumulatedAudioData.map(audio => ({
                inlineData: {
                  data: audio.data,
                  mimeType: audio.mimeType
                }
              }))
            };
          }
          
          mergedMessages.push(mergedMsg);
          currentOutputTranscription = null;
          accumulatedAudioData = [];
        }
      }
    }
    
    // Save any remaining accumulated transcriptions (for messages without turnComplete)
    if (currentInputTranscription) {
      const lastBuffered = bufferedMessages[bufferedMessages.length - 1];
      // Normalize text: remove extra spaces, clean up
      const normalizedText = currentInputTranscription.text
        .replace(/\s+/g, ' ') // Multiple spaces to single space
        .replace(/\s+([.,!?;:])/g, '$1') // Remove space before punctuation
        .trim();
      
      mergedMessages.push({
        conversationId: lastBuffered.conversationId,
        sessionId: lastBuffered.sessionId,
        response: {
          serverContent: {
            inputTranscription: {
              text: normalizedText,
              ...currentInputTranscription.original
            }
          }
        }
      });
    }
    
    if (currentOutputTranscription) {
      const lastBuffered = bufferedMessages[bufferedMessages.length - 1];
      // Normalize text: remove extra spaces, clean up
      const normalizedText = currentOutputTranscription.text
        .replace(/\s+/g, ' ') // Multiple spaces to single space
        .replace(/\s+([.,!?;:])/g, '$1') // Remove space before punctuation
        .trim();
      
      const mergedMsg = {
        conversationId: lastBuffered.conversationId,
        sessionId: lastBuffered.sessionId,
        response: {
          serverContent: {
            outputTranscription: {
              text: normalizedText,
              ...currentOutputTranscription.original
            }
          }
        }
      };
      
      if (accumulatedAudioData.length > 0) {
        mergedMsg.response.serverContent.modelTurn = {
          parts: accumulatedAudioData.map(audio => ({
            inlineData: {
              data: audio.data,
              mimeType: audio.mimeType
            }
          }))
        };
      }
      
      mergedMessages.push(mergedMsg);
    }
    
    // Save text-only messages that weren't part of transcriptions
    if (currentUserText) {
      const lastBuffered = bufferedMessages[bufferedMessages.length - 1];
      mergedMessages.push({
        conversationId: lastBuffered.conversationId,
        sessionId: lastBuffered.sessionId,
        response: {
          text: currentUserText,
          role: 'user'
        }
      });
    }
    
    if (currentModelText) {
      const lastBuffered = bufferedMessages[bufferedMessages.length - 1];
      mergedMessages.push({
        conversationId: lastBuffered.conversationId,
        sessionId: lastBuffered.sessionId,
        response: {
          text: currentModelText,
          role: 'model'
        }
      });
    }
    
    console.log(`🔄 Accumulated ${bufferedMessages.length} buffered messages into ${mergedMessages.length} complete messages`);
    return mergedMessages;
  }

  /**
   * Save Live API message to conversation
   * Properly handles input transcription (user) and output transcription (model) separately
   * @param {string} conversationId - Conversation ID
   * @param {string} sessionId - Live session ID
   * @param {Object} liveMessage - Live API message from Gemini
   * @param {Object} audioFile - Audio file information (optional)
   * @returns {Promise<Object|Array|null>} Saved message(s) or null if skipped
   */
  static async saveLiveMessageToConversation(conversationId, sessionId, liveMessage, audioFile = null) {
    try {
      const conversation = await Conversation.findOne({ conversationId });
      
      if (!conversation) {
        throw new Error(`Conversation ${conversationId} not found`);
      }

      console.log('🔍 Processing Live message structure:', JSON.stringify(liveMessage, null, 2));
      
      const savedMessages = [];
      
      // Handle input transcription (user speech) - save as USER message
      if (liveMessage.serverContent?.inputTranscription?.text) {
        const inputText = liveMessage.serverContent.inputTranscription.text.trim();
        if (inputText.length > 0) {
          const messageSequence = conversation.getNextMessageSequence();
          await conversation.save();
          
          const userMessage = new Message({
            messageId: uuidv4(),
            conversationId,
            userId: conversation.userId,
            messageSequence,
            messageType: 'live',
            role: 'user',
            content: {
              text: inputText
            },
            liveContent: {
              inputTranscription: liveMessage.serverContent.inputTranscription
            },
            config: {
              live: {
                model: conversation.config.live.model || 'gemini-2.0-flash-live-001',
                sessionId,
                responseModalities: conversation.config.live.responseModalities || ['AUDIO']
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
          });
          
          await userMessage.save();
          await conversation.incrementStats('live');
          conversation.session.lastActivity = new Date();
          await conversation.save();
          
          console.log(`💾 Saved USER message (input transcription): "${inputText.substring(0, 50)}..."`);
          savedMessages.push(userMessage);
        }
      }
      
      // Handle output transcription (AI response) - save as MODEL message
      if (liveMessage.serverContent?.outputTranscription?.text) {
        const outputText = liveMessage.serverContent.outputTranscription.text.trim();
        if (outputText.length > 0) {
          const messageSequence = conversation.getNextMessageSequence();
          await conversation.save();
          
          const liveContent = {
            outputTranscription: liveMessage.serverContent.outputTranscription
          };
          
          // Extract text from modelTurn parts if available
          let modelText = outputText;
          if (liveMessage.serverContent.modelTurn?.parts) {
            const textParts = liveMessage.serverContent.modelTurn.parts
              .map(part => part.text)
              .filter(text => text && text.trim().length > 0);
            if (textParts.length > 0) {
              modelText = textParts.join(' ');
            }
          }
          
          // Handle audio data if present
          if (liveMessage.serverContent.modelTurn?.parts) {
            for (const part of liveMessage.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType?.startsWith('audio/')) {
                liveContent.audioData = {
                  data: part.inlineData.data,
                  mimeType: part.inlineData.mimeType
                };
                break;
              }
            }
          }
          
          // Handle direct audio data field
          if (liveMessage.data) {
            liveContent.audioData = {
              data: liveMessage.data,
              mimeType: 'audio/pcm'
            };
          }
          
          // Handle stored audio file
          if (audioFile) {
            liveContent.audioData = {
              fileId: audioFile.fileId,
              url: audioFile.url,
              duration: audioFile.duration,
              mimeType: audioFile.mimeType
            };
          }
          
          const modelMessage = new Message({
            messageId: uuidv4(),
            conversationId,
            userId: conversation.userId,
            messageSequence,
            messageType: 'live',
            role: 'model',
            content: {
              text: modelText
            },
            liveContent,
            config: {
              live: {
                model: conversation.config.live.model || 'gemini-2.0-flash-live-001',
                sessionId,
                responseModalities: conversation.config.live.responseModalities || ['AUDIO']
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
          });
          
          await modelMessage.save();
          await conversation.incrementStats('live');
          conversation.session.lastActivity = new Date();
          await conversation.save();
          
          console.log(`💾 Saved MODEL message (output transcription): "${modelText.substring(0, 50)}..."`);
          savedMessages.push(modelMessage);
        }
      }
      
      // Handle text-only messages (from sendClientContent or sendMessage)
      if (liveMessage.text && !liveMessage.serverContent) {
        const text = liveMessage.text.trim();
        if (text.length > 0) {
          const messageSequence = conversation.getNextMessageSequence();
          await conversation.save();
          
          const role = liveMessage.role || 'user';
          
          const textMessage = new Message({
            messageId: uuidv4(),
            conversationId,
            userId: conversation.userId,
            messageSequence,
            messageType: 'live',
            role,
            content: {
              text: text
            },
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
          });
          
          await textMessage.save();
          await conversation.incrementStats('live');
          conversation.session.lastActivity = new Date();
          await conversation.save();
          
          console.log(`💾 Saved ${role.toUpperCase()} message (text): "${text.substring(0, 50)}..."`);
          savedMessages.push(textMessage);
        }
      }
      
      // Handle modelTurn with text but no transcription (fallback)
      if (liveMessage.serverContent?.modelTurn?.parts && 
          !liveMessage.serverContent.outputTranscription &&
          !liveMessage.serverContent.inputTranscription) {
        const textParts = liveMessage.serverContent.modelTurn.parts
          .map(part => part.text)
          .filter(text => text && text.trim().length > 0);
        
        if (textParts.length > 0) {
          const messageSequence = conversation.getNextMessageSequence();
          await conversation.save();
          
          const modelText = textParts.join(' ');
          const liveContent = {};
          
          // Handle audio data if present
          for (const part of liveMessage.serverContent.modelTurn.parts) {
            if (part.inlineData?.mimeType?.startsWith('audio/')) {
              liveContent.audioData = {
                data: part.inlineData.data,
                mimeType: part.inlineData.mimeType
              };
              break;
            }
          }
          
          const modelMessage = new Message({
            messageId: uuidv4(),
            conversationId,
            userId: conversation.userId,
            messageSequence,
            messageType: 'live',
            role: 'model',
            content: {
              text: modelText
            },
            liveContent: Object.keys(liveContent).length > 0 ? liveContent : undefined,
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
          });
          
          await modelMessage.save();
          await conversation.incrementStats('live');
          conversation.session.lastActivity = new Date();
          await conversation.save();
          
          console.log(`💾 Saved MODEL message (modelTurn text): "${modelText.substring(0, 50)}..."`);
          savedMessages.push(modelMessage);
        }
      }
      
      // Return saved messages
      if (savedMessages.length === 0) {
        console.log('⚠️ No messages saved - message had no extractable content');
        return null;
      }
      
      if (savedMessages.length === 1) {
        return savedMessages[0];
      }
      
      return savedMessages;
      
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