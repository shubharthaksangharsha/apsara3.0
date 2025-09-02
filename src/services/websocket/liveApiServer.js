import { v4 as uuidv4 } from 'uuid';
import { liveApiRateLimiter } from '../../middleware/rateLimiter.js';
import ProviderManager from '../../providers/ProviderManager.js';
import { SessionManager } from './SessionManager.js';
import LiveConversationService from '../LiveConversationService.js';
import AudioStorageService from '../AudioStorageService.js';
import { Conversation } from '../../models/index.js';
import ConversationService from '../database/ConversationService.js';

/**
 * Live API WebSocket Server
 * Handles real-time streaming interactions with AI models
 */
export class LiveApiServer {
  constructor() {
    this.clients = new Map();
    this.sessionManager = new SessionManager();
    this.audioStorage = new AudioStorageService();
    this.initialized = false;
  }

  /**
   * Initialize the Live API server
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      // Initialize audio storage
      await this.audioStorage.initialize();
      console.log('✅ Audio storage initialized for Live API');
      
      this.initialized = true;
    } catch (error) {
      console.error('❌ Failed to initialize Live API server:', error);
      throw error;
    }
  }

  /**
   * Handle new WebSocket connection
   */
  async handleConnection(ws, req) {
    const clientId = uuidv4();
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Rate limiting check
    const rateLimitResult = await liveApiRateLimiter(clientIp);
    if (!rateLimitResult.success) {
      ws.close(1008, JSON.stringify({
        error: 'Rate limit exceeded',
        retryAfter: rateLimitResult.retryAfter
      }));
      return;
    }

    console.log(`🔌 New Live API connection: ${clientId} from ${clientIp}`);

    // Initialize client state
    const client = {
      id: clientId,
      ws,
      ip: clientIp,
      sessions: new Map(),
      createdAt: new Date(),
      lastActivity: new Date()
    };

    this.clients.set(clientId, client);

    // Set up WebSocket event handlers
    ws.on('message', (data) => this.handleMessage(clientId, data));
    ws.on('close', () => this.handleDisconnection(clientId));
    ws.on('error', (error) => this.handleError(clientId, error));

    // Send welcome message
    this.sendToClient(clientId, {
      type: 'connection',
      clientId,
      message: 'Connected to Apsara Live API',
      timestamp: new Date().toISOString()
    });

    // Set up ping/pong for connection health
    this.setupHeartbeat(clientId);
  }

  /**
   * Handle incoming WebSocket messages
   */
  async handleMessage(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.lastActivity = new Date();

    try {
      let isJson = false;
      let parsedMessage = null;
      
      // Try to parse as JSON first
      try {
        if (typeof data === 'string') {
          parsedMessage = JSON.parse(data);
          isJson = true;
        } else if (Buffer.isBuffer(data)) {
          // Try to parse buffer as JSON
          const messageStr = data.toString('utf8');
          parsedMessage = JSON.parse(messageStr);
          isJson = true;
        }
      } catch (jsonError) {
        // Not JSON, will handle as binary data
        isJson = false;
      }

      if (isJson && parsedMessage) {
        // Handle structured JSON messages
        await this.handleStructuredMessage(clientId, parsedMessage);
      } else {
        // Handle raw binary data (audio/video streams)
        await this.handleBinaryMessage(clientId, data);
      }
    } catch (error) {
      console.error(`Message handling error for client ${clientId}:`, error);
      this.sendError(clientId, `Failed to process message: ${error.message}`);
    }
  }

  /**
   * Handle structured JSON messages
   */
  async handleStructuredMessage(clientId, data) {
    switch (data.type) {
      case 'create_session':
        await this.handleCreateSession(clientId, data);
        break;
      
      case 'send_message':
      case 'text':
        await this.handleSendMessage(clientId, data);
        break;
      
      case 'send_realtime_input':
        await this.handleRealtimeInput(clientId, data);
        break;
      
      case 'video_chunk':
        await this.handleVideoChunk(clientId, data);
        break;
      
      case 'screen_chunk':
        await this.handleScreenChunk(clientId, data);
        break;
      
      case 'send_incremental_update':
        await this.handleIncrementalUpdate(clientId, data);
        break;
      
      case 'send_tool_response':
        await this.handleToolResponse(clientId, data);
        break;
      
      case 'end_session':
        await this.handleEndSession(clientId, data);
        break;
      
      case 'ping':
        this.sendToClient(clientId, { type: 'pong', timestamp: new Date().toISOString() });
        break;
      
      default:
        this.sendError(clientId, `Unknown message type: ${data.type}`);
    }
  }

  /**
   * Handle binary messages (raw audio/video data)
   */
  async handleBinaryMessage(clientId, message) {
    try {
      const client = this.clients.get(clientId);
      if (!client || client.sessions.size === 0) {
        return this.sendError(clientId, 'No active session for binary data');
      }

      // Get the first active session
      const sessionData = Array.from(client.sessions.values())[0];
      
      if (!sessionData) {
        return this.sendError(clientId, 'No active session found');
      }

      sessionData.lastActivity = new Date();

      // Handle raw binary data (assume audio PCM)
      const base64Data = message.toString('base64');
      
      console.log(`[Live Backend] Received raw binary data from client ${clientId}. Sending as audio via sendRealtimeInput.`);
      
      await sessionData.session.sendRealtimeInput({
        audio: { 
          data: base64Data, 
          mimeType: 'audio/pcm;rate=16000'
        }
      });

      console.log(`[Live Backend] Sent binary audio data via sendRealtimeInput for session ${sessionData.id}.`);

    } catch (error) {
      console.error(`[Live Backend] Error processing binary message:`, error);
      this.sendError(clientId, `Failed to process binary data: ${error.message}`);
    }
  }

  /**
   * Handle video chunk messages
   */
  async handleVideoChunk(clientId, data) {
    try {
      const { chunk, sessionId } = data;
      
      if (!chunk || !chunk.data || !chunk.mimeType) {
        return this.sendError(clientId, 'Invalid video chunk data');
      }

      const client = this.clients.get(clientId);
      const sessionData = sessionId ? 
        client.sessions.get(sessionId) : 
        Array.from(client.sessions.values())[0];
      
      if (!sessionData) {
        return this.sendError(clientId, 'No active session for video chunk');
      }

      sessionData.lastActivity = new Date();

      console.log(`[Live Backend] Received video chunk from client ${clientId}. Sending via sendRealtimeInput.`);

      await sessionData.session.sendRealtimeInput({
        video: {
          data: chunk.data,
          mimeType: chunk.mimeType
        }
      });

      console.log(`[Live Backend] Sent video chunk via sendRealtimeInput for session ${sessionData.id}.`);

    } catch (error) {
      console.error('Video chunk error:', error);
      this.sendError(clientId, `Failed to process video chunk: ${error.message}`);
    }
  }

  /**
   * Handle screen share chunk messages
   */
  async handleScreenChunk(clientId, data) {
    try {
      const { chunk, sessionId } = data;
      
      if (!chunk || !chunk.data || !chunk.mimeType) {
        return this.sendError(clientId, 'Invalid screen chunk data');
      }

      const client = this.clients.get(clientId);
      const sessionData = sessionId ? 
        client.sessions.get(sessionId) : 
        Array.from(client.sessions.values())[0];
      
      if (!sessionData) {
        return this.sendError(clientId, 'No active session for screen chunk');
      }

      sessionData.lastActivity = new Date();

      console.log(`[Live Backend] Received screen chunk from client ${clientId}. Sending via sendRealtimeInput.`);

      // Send screen share as video input to Google Live API
      await sessionData.session.sendRealtimeInput({
        video: {
          data: chunk.data,
          mimeType: chunk.mimeType
        }
      });

      console.log(`[Live Backend] Sent screen chunk via sendRealtimeInput for session ${sessionData.id}.`);

    } catch (error) {
      console.error('Screen chunk error:', error);
      this.sendError(clientId, `Failed to process screen chunk: ${error.message}`);
    }
  }

  /**
   * Handle session creation
   */
  async handleCreateSession(clientId, message) {
    try {
      console.log(`📥 Received create_session message:`, JSON.stringify(message, null, 2));
      
      const {
        model = 'gemini-2.0-flash-live-001',
        provider = 'google',
        config = {},
        sessionId = uuidv4(),
        resumeHandle = null,
        conversationId = null,
        userId = null,
        loadConversationContext = true
      } = message.data || {};

      console.log('🔍 Session creation parameters:');
      console.log('  conversationId:', conversationId, 'type:', typeof conversationId);
      console.log('  userId:', userId, 'type:', typeof userId);
      console.log('  loadConversationContext:', loadConversationContext);

      const client = this.clients.get(clientId);
      
      // Check session limits
      const maxSessions = parseInt(process.env.MAX_SESSIONS_PER_USER) || 5;
      if (client.sessions.size >= maxSessions) {
        return this.sendError(clientId, `Maximum number of sessions reached (${maxSessions})`);
      }

      // Use client-generated sessionId since Gemini Live might return N/A
      const finalSessionId = sessionId; // Always use our client-generated ID
      
      // Create live session with provider
      const sessionCallbacks = {
        onopen: () => {
          this.sendToClient(clientId, {
            type: 'session_opened',
            sessionId: finalSessionId,
            timestamp: new Date().toISOString()
          });
        },
        
        onmessage: async (response) => {
          // Handle session resumption updates
          if (response.sessionResumptionUpdate) {
            this.sendToClient(clientId, {
              type: 'session_resumption_update',
              sessionId: finalSessionId,
              data: response.sessionResumptionUpdate,
              timestamp: new Date().toISOString()
            });

            // Update resumption handle in conversation
            if (conversationId && response.sessionResumptionUpdate.newHandle) {
              try {
                await LiveConversationService.handleSessionResumption(
                  conversationId,
                  response.sessionResumptionUpdate.newHandle
                );
              } catch (error) {
                console.error('Error updating resumption handle:', error);
              }
            }
          }
          
          // Handle GoAway messages
          if (response.goAway) {
            this.sendToClient(clientId, {
              type: 'go_away',
              sessionId: finalSessionId,
              data: response.goAway,
              timestamp: new Date().toISOString()
            });
          }
          
          // Handle generation complete
          if (response.serverContent && response.serverContent.generationComplete) {
            this.sendToClient(clientId, {
              type: 'generation_complete',
              sessionId: finalSessionId,
              timestamp: new Date().toISOString()
            });
          }

          // Save AI response to conversation if linked
          const sessionData = client.sessions.get(finalSessionId);
          if (sessionData?.conversationId && (response.text || response.serverContent)) {
            try {
              await LiveConversationService.saveLiveMessageToConversation(
                sessionData.conversationId,
                finalSessionId,
                response
              );
              console.log(`💾 Saved AI response to conversation ${sessionData.conversationId}`);
            } catch (saveError) {
              console.error('Error saving AI response to conversation:', saveError);
            }
          }
          
          // Send all messages
          this.sendToClient(clientId, {
            type: 'session_message',
            sessionId: finalSessionId,
            data: response,
            timestamp: new Date().toISOString()
          });
        },
        
        onerror: (error) => {
          this.sendToClient(clientId, {
            type: 'session_error',
            sessionId: finalSessionId,
            error: error.message,
            timestamp: new Date().toISOString()
          });
        },
        
        onclose: (reason) => {
          console.log(`🔴 Live session closing - sessionId: ${finalSessionId}, reason:`, reason);
          
          this.sendToClient(clientId, {
            type: 'session_closed',
            sessionId: finalSessionId,
            reason,
            timestamp: new Date().toISOString()
          });
          
          // Clean up session
          console.log(`🧹 Cleaning up session ${finalSessionId} from client sessions`);
          client.sessions.delete(finalSessionId);
          this.sessionManager.removeSession(finalSessionId);
        }
      };

      // Enhanced config with only essential features (keep it minimal to avoid invalid arguments)
      const enhancedConfig = {
        ...config
        // Only add session resumption if we have a handle
        // ...(resumeHandle && { sessionResumption: { handle: resumeHandle } })
        // Remove other potentially problematic settings for now
      };

      console.log(`🔧 Enhanced config being sent to Gemini:`, JSON.stringify(enhancedConfig, null, 2));
      
      let liveSession;
      try {
        liveSession = await ProviderManager.createLiveSession({
          model,
          provider,
          config: enhancedConfig,
          callbacks: sessionCallbacks
        });

        console.log(`🎯 Live session created successfully:`, {
          success: liveSession.success,
          provider: liveSession.provider,
          model: liveSession.model,
          sessionId: liveSession.sessionId
        });
      } catch (sessionError) {
        console.error(`❌ Failed to create Live session with Gemini:`, sessionError);
        console.error(`❌ Session error details:`, sessionError.message);
        throw new Error(`Failed to create Live session: ${sessionError.message}`);
      }

      const geminiSessionId = liveSession.session?.id || 'N/A';
      
      console.log(`📋 Session IDs - Client: ${finalSessionId}, Gemini: ${geminiSessionId}`);

      // Handle conversation integration
      let finalConversationId = conversationId;
      
      if (userId) {
        try {
          if (!conversationId) {
            // Create new conversation for Live API session
            console.log(`📝 Creating new Live conversation for user ${userId}`);
            const conversation = await ConversationService.createConversation(
              userId, 
              'live', 
              {
                model,
                responseModalities: enhancedConfig.responseModalities || ['TEXT'],
                mediaResolution: enhancedConfig.realtimeInputConfig?.mediaResolution || 'MEDIUM'
              }
            );
            finalConversationId = conversation.conversationId;
            console.log(`✅ Created new Live conversation: ${finalConversationId}`);
          } else {
            // Use existing conversation - transition to Live mode
            console.log(`🔄 Transitioning conversation ${conversationId} to Live mode`);
            await ConversationService.transitionToLive(conversationId, userId, enhancedConfig);
            finalConversationId = conversationId;
          }

          // Link session to conversation
          console.log(`🔗 Linking Live session ${finalSessionId} to conversation ${finalConversationId}`);
          await LiveConversationService.linkLiveSessionToConversation(
            finalConversationId, 
            finalSessionId, 
            enhancedConfig
          );

          // Load conversation context if requested and conversation exists
          if (loadConversationContext && conversationId) {
            console.log(`📚 Loading conversation context for ${finalConversationId}`);
            
            const contextResult = await LiveConversationService.loadConversationContextToLive(
              finalConversationId,
              liveSession.session,
              20, // Load last 20 messages
              finalSessionId // Pass the actual session ID
            );

            this.sendToClient(clientId, {
              type: 'context_loaded',
              sessionId: finalSessionId,
              conversationId: finalConversationId,
              messagesLoaded: contextResult.messagesLoaded,
              turnsLoaded: contextResult.turnsLoaded,
              timestamp: new Date().toISOString()
            });
          }

        } catch (contextError) {
          console.error('Error handling conversation integration:', contextError);
          console.error('Context error details:', {
            conversationId: finalConversationId,
            userId,
            loadConversationContext,
            stack: contextError.stack
          });
          this.sendToClient(clientId, {
            type: 'context_load_error',
            sessionId: finalSessionId,
            conversationId: finalConversationId,
            error: contextError.message,
            timestamp: new Date().toISOString()
          });
        }
      }

      console.log(`🔗 Session stored in client.sessions with key: ${finalSessionId}`);
      console.log(`📊 Current client session count: ${client.sessions.size}`);

      // Store session with final conversation ID
      client.sessions.set(finalSessionId, {
        id: finalSessionId,
        geminiSessionId: geminiSessionId,
        session: liveSession.session,
        model,
        provider,
        conversationId: finalConversationId,
        userId,
        createdAt: new Date(),
        lastActivity: new Date()
      });

      this.sessionManager.addSession(finalSessionId, {
        clientId,
        session: liveSession.session,
        model,
        provider,
        conversationId: finalConversationId,
        userId,
        geminiSessionId: geminiSessionId
      });

      console.log(`🚀 Sending session_created message to client ${clientId}`);
      this.sendToClient(clientId, {
        type: 'session_created',
        sessionId: finalSessionId,
        geminiSessionId: geminiSessionId,
        model,
        provider,
        conversationId: finalConversationId,
        timestamp: new Date().toISOString()
      });
      
      console.log(`✅ Session creation completed successfully for ${finalSessionId}`);

    } catch (error) {
      console.error('❌ Create session error:', error);
      console.error('❌ Error stack:', error.stack);
      this.sendError(clientId, `Failed to create session: ${error.message}`);
    }
  }

  /**
   * Handle sending messages to a session
   */
  async handleSendMessage(clientId, message) {
    try {
      console.log(`📤 handleSendMessage received:`, JSON.stringify(message, null, 2));
      
      let sessionId, text, file, turnComplete = true;
      
      // Handle different message formats
      if (message.type === 'text' && message.text) {
        // Handle simple text message format: { type: 'text', text: 'content' }
        text = message.text;
        // Try to get sessionId from first active session if not provided
        const client = this.clients.get(clientId);
        if (client && client.sessions.size > 0) {
          sessionId = Array.from(client.sessions.keys())[0];
        }
      } else if (message.type === 'send_message') {
        // Handle structured message format: { type: 'send_message', sessionId: 'xxx', data: { ... } }
        sessionId = message.sessionId || (message.data && message.data.sessionId);
        const data = message.data || {};
        
        // Handle turns format (multimodal) vs simple format
        if (data.turns && Array.isArray(data.turns) && data.turns.length > 0) {
          // Extract from turns format: { turns: [{ role: 'user', parts: [...] }] }
          const userTurn = data.turns.find(turn => turn.role === 'user');
          if (userTurn && userTurn.parts && Array.isArray(userTurn.parts)) {
            // Extract text from parts
            const textPart = userTurn.parts.find(part => part.text);
            if (textPart) {
              text = textPart.text;
            }
            
            // Extract file from parts (fileData or inlineData)
            const filePart = userTurn.parts.find(part => part.fileData || part.inlineData);
            if (filePart) {
              if (filePart.fileData) {
                // Large file via Google File API
                file = {
                  uri: filePart.fileData.fileUri,
                  mimeType: filePart.fileData.mimeType
                };
              } else if (filePart.inlineData) {
                // Small file inline
                file = {
                  data: filePart.inlineData.data,
                  mimeType: filePart.inlineData.mimeType
                };
              }
            }
          }
        } else {
          // Handle simple format: { text: 'content', file: {...} }
          text = data.text;
          file = data.file;
        }
        
        turnComplete = data.turnComplete !== undefined ? data.turnComplete : true;
      } else {
        // Fallback: try to extract from any format
        sessionId = message.sessionId || (message.data && message.data.sessionId);
        text = message.text || (message.data && message.data.text);
        file = message.file || (message.data && message.data.file);
        turnComplete = message.turnComplete !== undefined ? message.turnComplete : 
                      (message.data && message.data.turnComplete !== undefined ? message.data.turnComplete : true);
      }
      
      console.log(`📋 Extracted - sessionId: ${sessionId}, text: "${text}", type: ${message.type}, hasFile: ${!!file}`);
      
      const client = this.clients.get(clientId);
      console.log(`🔍 Available sessions for client:`, Array.from(client.sessions.keys()));
      
      const sessionData = client.sessions.get(sessionId);
      
      if (!sessionData) {
        console.log(`❌ Session ${sessionId} not found. Available sessions:`, Array.from(client.sessions.keys()));
        return this.sendError(clientId, `Session ${sessionId} not found`);
      }

      sessionData.lastActivity = new Date();

      // Build content parts based on input type
      const parts = [];
      
      if (text && typeof text === 'string') {
        console.log(`[Live Backend] Received TEXT JSON from client ${clientId}. Sending via sendClientContent.`);
        parts.push({ text: text.trim() });
      }
      
      if (file) {
        if (file.uri && file.mimeType) {
          // File already uploaded to provider
          parts.push({
            fileData: {
              mimeType: file.mimeType,
              fileUri: file.uri
            }
          });
        } else if (file.data && file.mimeType) {
          // Inline file data
          parts.push({
            inlineData: {
              mimeType: file.mimeType,
              data: file.data
            }
          });
        }
      }

      if (parts.length === 0) {
        return this.sendError(clientId, 'No valid content provided (text or file required)');
      }

      // Send content to the live session via sendClientContent
      await sessionData.session.sendClientContent({
        turns: [{ role: 'user', parts }],
        turnComplete
      });

      console.log(`[Live Backend] Sent text data via sendClientContent for session ${sessionData.id}.`);

      // Save user message to conversation if linked
      const sessionInfo = this.sessionManager.getSession(sessionId);
      if (sessionInfo && sessionInfo.conversationId) {
        try {
          const userMessage = {
            text: text,
            role: 'user',
            sessionId: sessionId
          };

          await LiveConversationService.saveLiveMessageToConversation(
            sessionInfo.conversationId,
            sessionId,
            userMessage
          );
          console.log(`💾 Saved user message to conversation ${sessionInfo.conversationId}`);
        } catch (saveError) {
          console.error('Error saving user message to conversation:', saveError);
        }
      }

    } catch (error) {
      console.error('Send message error:', error);
      this.sendError(clientId, `Failed to send message: ${error.message}`);
    }
  }

  /**
   * Handle realtime input (audio, video, images)
   */
  async handleRealtimeInput(clientId, message) {
    try {
      const { 
        sessionId, 
        audio, 
        video, 
        image,
        screen,
        audioStreamEnd = false,
        activityStart = false,
        activityEnd = false
      } = message.data || {};
      
      const client = this.clients.get(clientId);
      const sessionData = client.sessions.get(sessionId);
      
      if (!sessionData) {
        return this.sendError(clientId, `Session ${sessionId} not found`);
      }

      sessionData.lastActivity = new Date();

      // Build realtime input based on type
      let realtimeInput = {};

      if (audio) {
        realtimeInput.audio = {
          data: audio.data,
          mimeType: audio.mimeType || "audio/pcm;rate=16000"
        };
      }
      
      if (video) {
        realtimeInput.video = {
          data: video.data,
          mimeType: video.mimeType || "video/mp4"
        };
      }
      
      if (image) {
        realtimeInput.image = {
          data: image.data,
          mimeType: image.mimeType || "image/jpeg"
        };
      }

      if (screen) {
        // Handle screen share as video input to Google Live API
        realtimeInput.video = {
          data: screen.data,
          mimeType: screen.mimeType || "video/mp4"
        };
      }

      // Handle audio stream events
      if (audioStreamEnd) {
        realtimeInput.audioStreamEnd = true;
      }
      
      if (activityStart) {
        realtimeInput.activityStart = {};
      }
      
      if (activityEnd) {
        realtimeInput.activityEnd = {};
      }

      if (Object.keys(realtimeInput).length === 0) {
        return this.sendError(clientId, 'No valid realtime input provided (audio, video, image, screen, or stream event required)');
      }

      // Send realtime input to the live session
      sessionData.session.sendRealtimeInput(realtimeInput);

    } catch (error) {
      console.error('Realtime input error:', error);
      this.sendError(clientId, `Failed to send realtime input: ${error.message}`);
    }
  }

  /**
   * Handle incremental content updates for session context
   */
  async handleIncrementalUpdate(clientId, message) {
    try {
      const { 
        sessionId, 
        turns, 
        turnComplete = false 
      } = message.data || {};
      
      const client = this.clients.get(clientId);
      const sessionData = client.sessions.get(sessionId);
      
      if (!sessionData) {
        return this.sendError(clientId, `Session ${sessionId} not found`);
      }

      sessionData.lastActivity = new Date();

      // Send incremental content update to the live session
      sessionData.session.sendClientContent({
        turns,
        turnComplete
      });

    } catch (error) {
      console.error('Incremental update error:', error);
      this.sendError(clientId, `Failed to send incremental update: ${error.message}`);
    }
  }

  /**
   * Handle tool response
   */
  async handleToolResponse(clientId, message) {
    try {
      const { sessionId, functionResponses } = message.data || {};
      
      const client = this.clients.get(clientId);
      const sessionData = client.sessions.get(sessionId);
      
      if (!sessionData) {
        return this.sendError(clientId, `Session ${sessionId} not found`);
      }

      sessionData.lastActivity = new Date();

      // Send tool response to the live session
      sessionData.session.sendToolResponse({ functionResponses });

    } catch (error) {
      console.error('Tool response error:', error);
      this.sendError(clientId, `Failed to send tool response: ${error.message}`);
    }
  }

  /**
   * Handle ending a session
   */
  async handleEndSession(clientId, message) {
    try {
      const { sessionId } = message.data || {};
      
      const client = this.clients.get(clientId);
      const sessionData = client.sessions.get(sessionId);
      
      if (!sessionData) {
        return this.sendError(clientId, `Session ${sessionId} not found`);
      }

      // Close the live session
      sessionData.session.close();
      
      // Clean up
      client.sessions.delete(sessionId);
      this.sessionManager.removeSession(sessionId);

      this.sendToClient(clientId, {
        type: 'session_ended',
        sessionId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('End session error:', error);
      this.sendError(clientId, `Failed to end session: ${error.message}`);
    }
  }

  /**
   * Handle client disconnection
   */
  handleDisconnection(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    console.log(`🔌 Client disconnected: ${clientId}`);

    // Close all sessions for this client
    for (const [sessionId, sessionData] of client.sessions) {
      try {
        sessionData.session.close();
        this.sessionManager.removeSession(sessionId);
      } catch (error) {
        console.error(`Error closing session ${sessionId}:`, error);
      }
    }

    // Remove client
    this.clients.delete(clientId);
  }

  /**
   * Handle WebSocket errors
   */
  handleError(clientId, error) {
    console.error(`WebSocket error for client ${clientId}:`, error);
    this.sendError(clientId, 'WebSocket error occurred');
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== 1) return;

    try {
      client.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(`Failed to send message to client ${clientId}:`, error);
    }
  }

  /**
   * Send error message to client
   */
  sendError(clientId, errorMessage) {
    this.sendToClient(clientId, {
      type: 'error',
      error: errorMessage,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Set up heartbeat mechanism
   */
  setupHeartbeat(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const heartbeatInterval = setInterval(() => {
      if (client.ws.readyState !== 1) {
        clearInterval(heartbeatInterval);
        return;
      }

      // Check for inactive sessions
      const now = new Date();
      const sessionTimeout = parseInt(process.env.SESSION_TIMEOUT) || 900000; // 15 minutes

      for (const [sessionId, sessionData] of client.sessions) {
        if (now - sessionData.lastActivity > sessionTimeout) {
          console.log(`Session ${sessionId} timed out, closing...`);
          sessionData.session.close();
          client.sessions.delete(sessionId);
          this.sessionManager.removeSession(sessionId);
        }
      }

      // Send ping
      this.sendToClient(clientId, { 
        type: 'ping', 
        timestamp: new Date().toISOString() 
      });
    }, 30000); // 30 seconds
  }

  /**
   * Get server statistics
   */
  getStats() {
    const totalSessions = Array.from(this.clients.values())
      .reduce((sum, client) => sum + client.sessions.size, 0);

    return {
      connectedClients: this.clients.size,
      totalSessions,
      sessionsByProvider: this.sessionManager.getSessionStats()
    };
  }

  /**
   * Broadcast message to all clients
   */
  broadcast(message) {
    for (const client of this.clients.values()) {
      this.sendToClient(client.id, message);
    }
  }
}

/**
 * Setup WebSocket server with the provided WebSocketServer instance
 */
export async function setupWebSocketServer(wss) {
  const liveApiServer = new LiveApiServer();
  
  // Initialize the Live API server (includes audio storage)
  await liveApiServer.initialize();

  wss.on('connection', (ws, req) => {
    liveApiServer.handleConnection(ws, req);
  });

  // Add server stats endpoint
  wss.getStats = () => liveApiServer.getStats();
  wss.broadcast = (message) => liveApiServer.broadcast(message);

  console.log('✅ Live API WebSocket server configured');
  
  return liveApiServer;
} 