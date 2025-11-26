import { v4 as uuidv4 } from 'uuid';
import { liveApiRateLimiter } from '../../middleware/rateLimiter.js';
import ProviderManager from '../../providers/ProviderManager.js';
import { LiveSessionManager } from './LiveSessionManager.js';
import { Conversation, Message } from '../../models/index.js';
import ConversationService from '../database/ConversationService.js';

/**
 * Live API Service
 * Handles WebSocket connections for real-time AI interactions with Gemini Live API
 * 
 * Key Features:
 * - AUDIO response modality by default
 * - Input and output transcription enabled
 * - Saves transcriptions to conversation history (not audio data)
 * - Supports text and audio input from users
 * - Accumulates transcription fragments before saving
 */
export class LiveApiService {
  constructor() {
    this.clients = new Map();
    this.sessionManager = new LiveSessionManager();
    this.initialized = false;
  }

  /**
   * Initialize the Live API service
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      this.sessionManager.startPeriodicCleanup();
      this.initialized = true;
      console.log('✅ Live API Service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Live API Service:', error);
      throw error;
    }
  }

  /**
   * Handle new WebSocket connection
   */
  async handleConnection(ws, req) {
    const clientId = uuidv4();
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Rate limiting
    const rateLimitResult = await liveApiRateLimiter(clientIp);
    if (!rateLimitResult.success) {
      ws.close(1008, JSON.stringify({
        error: 'Rate limit exceeded',
        retryAfter: rateLimitResult.retryAfter
      }));
      return;
    }

    console.log(`🔌 New Live API connection: ${clientId}`);

    // Initialize client state
    const client = {
      id: clientId,
      ws,
      ip: clientIp,
      session: null,
      createdAt: new Date(),
      lastActivity: new Date()
    };

    this.clients.set(clientId, client);

    // Setup event handlers
    ws.on('message', (data) => this.handleMessage(clientId, data));
    ws.on('close', () => this.handleDisconnection(clientId));
    ws.on('error', (error) => this.handleError(clientId, error));

    // Send welcome
    this.sendToClient(clientId, {
      type: 'connected',
      clientId,
      message: 'Connected to Apsara Live API',
      timestamp: new Date().toISOString()
    });

    // Setup heartbeat
    this.setupHeartbeat(clientId);
  }

  /**
   * Handle incoming WebSocket message
   */
  async handleMessage(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.lastActivity = new Date();

    try {
      // Try JSON first
      let message;
      try {
        message = typeof data === 'string' ? JSON.parse(data) : JSON.parse(data.toString('utf8'));
      } catch {
        // Binary data (audio)
        return this.handleAudioData(clientId, data);
      }

      // Route message
      switch (message.type) {
        case 'create_session':
          await this.handleCreateSession(clientId, message);
          break;
        case 'send_text':
        case 'text':
          await this.handleSendText(clientId, message);
          break;
        case 'send_audio':
          await this.handleSendAudio(clientId, message);
          break;
        case 'send_video':
          await this.handleSendVideo(clientId, message);
          break;
        case 'send_context':
          await this.handleSendContext(clientId, message);
          break;
        case 'end_session':
          await this.handleEndSession(clientId, message);
          break;
        case 'ping':
          this.sendToClient(clientId, { type: 'pong', timestamp: new Date().toISOString() });
          break;
        default:
          console.log(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`Message error for client ${clientId}:`, error);
      this.sendError(clientId, error.message);
    }
  }

  /**
   * Handle session creation
   * Creates a Gemini Live session with AUDIO response modality and transcription enabled
   */
  async handleCreateSession(clientId, message) {
    try {
      const {
        model = 'gemini-2.0-flash-live-001',
        conversationId = null,
        userId,
        systemInstruction = null,
        voice = 'Aoede',
        language = 'en-US'
      } = message.data || {};

      if (!userId) {
        return this.sendError(clientId, 'userId is required');
      }

      const client = this.clients.get(clientId);
      const sessionId = uuidv4();

      console.log(`📝 Creating Live session: ${sessionId}`);
      console.log(`   User: ${userId}, ConversationId: ${conversationId || 'new'}`);

      // Create or get conversation
      let finalConversationId = conversationId;
      if (!conversationId) {
        // Create new conversation
        const conversation = await ConversationService.createConversation(userId, 'live', {
          liveModel: model,
          responseModalities: ['AUDIO']
        });
        finalConversationId = conversation.conversationId;
        console.log(`✅ Created new conversation: ${finalConversationId}`);
      } else {
        // Verify conversation exists
        const conversation = await Conversation.findOne({ conversationId });
        if (!conversation) {
          return this.sendError(clientId, `Conversation ${conversationId} not found`);
        }
        // Update to live mode
        conversation.type = conversation.type === 'rest' ? 'hybrid' : conversation.type;
        conversation.session.liveSessionId = sessionId;
        conversation.session.isLiveActive = true;
        await conversation.save();
        console.log(`✅ Using existing conversation: ${finalConversationId}`);
        
        // Load existing messages to send as context
        try {
          const Message = (await import('../../models/Message.js')).default;
          const existingMessages = await Message.find({ conversationId })
            .sort({ 'metadata.timing.requestTime': 1 })
            .limit(20) // Last 20 messages for context
            .lean();
          
          if (existingMessages.length > 0) {
            const contextTurns = existingMessages
              .filter(msg => msg.content?.text) // Only text messages
              .map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content.text }]
              }));
            
            if (contextTurns.length > 0) {
              // Store context to send after session is ready
              client.pendingContext = contextTurns;
              console.log(`📚 Loaded ${contextTurns.length} messages as context for Gemini`);
            }
          }
        } catch (contextError) {
          console.error('Error loading conversation context:', contextError);
          // Continue without context - non-fatal error
        }
      }

      // Build Live API config
      // AUDIO response modality by default, with transcription enabled
      const liveConfig = {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice
            }
          },
          languageCode: language
        },
        // Enable transcriptions - this is key for saving conversation history
        outputAudioTranscription: {},
        inputAudioTranscription: {}
      };

      // Set system instruction - use provided or default Apsara AI personality
      const apsaraSystemInstruction = systemInstruction || {
        parts: [{
          text: `You are Apsara AI, a sophisticated and friendly voice assistant developed by Shubharthak Sangharsha. 

About You:
- Your name is Apsara, inspired by celestial beings known for their grace and beauty
- You were created by Shubharthak Sangharsha, a passionate developer dedicated to building helpful AI assistants
- You are designed to be helpful, informative, and conversational
- You speak naturally and warmly, like a knowledgeable friend

Your Personality:
- Friendly, warm, and approachable
- Intelligent and knowledgeable across many topics
- Concise but thorough in your responses
- You use natural conversational language, not robotic speech
- You're enthusiastic about helping users

Guidelines:
- Keep responses conversational and natural for voice
- Be concise - long responses are hard to follow in voice format
- If asked about yourself, proudly mention you're Apsara AI created by Shubharthak
- Be helpful and positive
- For complex topics, break down information into digestible parts

Remember: You're having a real-time voice conversation, so keep responses natural and flowing.`
        }]
      };
      
      liveConfig.systemInstruction = apsaraSystemInstruction;

      console.log(`🔧 Live config:`, JSON.stringify(liveConfig, null, 2));

      // Create Gemini Live session
      // Note: We need to send context AFTER the session is stored, not in onopen
      // because liveSession isn't assigned yet during the callback
      const liveSession = await ProviderManager.createLiveSession({
        model,
        provider: 'google',
        config: liveConfig,
        callbacks: {
          onopen: async () => {
            console.log(`🟢 Gemini session opened: ${sessionId}`);
            
            // First notify client that session is ready
            this.sendToClient(clientId, {
              type: 'session_ready',
              sessionId,
              conversationId: finalConversationId,
              timestamp: new Date().toISOString()
            });
          },
          
          onmessage: async (response) => {
            await this.handleGeminiMessage(clientId, sessionId, response);
          },
          
          onerror: (error) => {
            console.error(`🔴 Gemini session error: ${sessionId}`, error);
            this.sendToClient(clientId, {
              type: 'session_error',
              sessionId,
              error: error.message,
              timestamp: new Date().toISOString()
            });
          },
          
          onclose: async (reason) => {
            console.log(`🔴 Gemini session closed: ${sessionId}`);
            await this.saveSessionMessages(clientId, sessionId);
            this.sendToClient(clientId, {
              type: 'session_closed',
              sessionId,
              reason,
              timestamp: new Date().toISOString()
            });
          }
        }
      });

      // Store session
      client.session = {
        id: sessionId,
        geminiSession: liveSession.session,
        model,
        conversationId: finalConversationId,
        userId,
        createdAt: new Date(),
        // Transcription accumulators
        currentInputTranscription: '',
        currentOutputTranscription: '',
        // Message buffer for saving complete turns
        pendingMessages: []
      };

      this.sessionManager.addSession(sessionId, {
        clientId,
        conversationId: finalConversationId,
        userId,
        model
      });

      // Send pending context if we have it (for existing conversations)
      if (client.pendingContext && client.pendingContext.length > 0) {
        try {
          console.log(`📤 Sending ${client.pendingContext.length} context turns to Gemini`);
          await client.session.geminiSession.sendClientContent({
            turns: client.pendingContext,
            turnComplete: true
          });
          console.log(`✅ Context loaded into Gemini session`);
          delete client.pendingContext;
        } catch (contextError) {
          console.error('Error sending context to Gemini:', contextError);
        }
      }

      this.sendToClient(clientId, {
        type: 'session_created',
        sessionId,
        conversationId: finalConversationId,
        model,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Create session error:', error);
      this.sendError(clientId, `Failed to create session: ${error.message}`);
    }
  }

  /**
   * Handle Gemini Live API messages
   * Processes transcriptions and audio data
   */
  async handleGeminiMessage(clientId, sessionId, response) {
    const client = this.clients.get(clientId);
    if (!client?.session) return;

    const session = client.session;
    let audioSent = false; // Track if we've already sent audio for this message

    // Handle input transcription (user speech)
    if (response.serverContent?.inputTranscription?.text) {
      const text = response.serverContent.inputTranscription.text;
      session.currentInputTranscription = this.accumulateTranscription(
        session.currentInputTranscription,
        text
      );
      
      console.log(`📝 Input transcription: "${session.currentInputTranscription}"`);
      
      this.sendToClient(clientId, {
        type: 'input_transcription',
        sessionId,
        text: session.currentInputTranscription,
        isPartial: true,
        timestamp: new Date().toISOString()
      });
    }

    // Handle output transcription (AI speech)
    if (response.serverContent?.outputTranscription?.text) {
      const text = response.serverContent.outputTranscription.text;
      session.currentOutputTranscription = this.accumulateTranscription(
        session.currentOutputTranscription,
        text
      );
      
      console.log(`📝 Output transcription: "${session.currentOutputTranscription}"`);
      
      this.sendToClient(clientId, {
        type: 'output_transcription',
        sessionId,
        text: session.currentOutputTranscription,
        isPartial: true,
        timestamp: new Date().toISOString()
      });
    }

    // Handle audio data - ONLY from response.data (main audio stream)
    // Don't also send from modelTurn.parts to avoid echoing/duplicate
    if (response.data && !audioSent) {
      this.sendToClient(clientId, {
        type: 'audio_data',
        sessionId,
        data: response.data,
        mimeType: 'audio/pcm;rate=24000',
        timestamp: new Date().toISOString()
      });
      audioSent = true;
    }

    // Handle modelTurn with audio - ONLY if we haven't sent audio yet
    if (response.serverContent?.modelTurn?.parts && !audioSent) {
      for (const part of response.serverContent.modelTurn.parts) {
        if (part.inlineData?.mimeType?.startsWith('audio/') && !audioSent) {
          this.sendToClient(clientId, {
            type: 'audio_data',
            sessionId,
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType,
            timestamp: new Date().toISOString()
          });
          audioSent = true;
          break; // Only send one audio chunk per message
        }
      }
    }

    // Handle turn complete - save accumulated transcriptions
    if (response.serverContent?.turnComplete) {
      console.log(`✅ Turn complete - Input: "${session.currentInputTranscription}", Output: "${session.currentOutputTranscription}"`);
      await this.saveTurnMessages(clientId, sessionId);
      
      this.sendToClient(clientId, {
        type: 'turn_complete',
        sessionId,
        timestamp: new Date().toISOString()
      });
    }

    // Handle generation complete
    if (response.serverContent?.generationComplete) {
      console.log(`✅ Generation complete - Final output transcription: "${session.currentOutputTranscription}"`);
      
      // Save any remaining transcriptions on generation complete
      if (session.currentOutputTranscription || session.currentInputTranscription) {
        await this.saveTurnMessages(clientId, sessionId);
      }
      
      this.sendToClient(clientId, {
        type: 'generation_complete',
        sessionId,
        timestamp: new Date().toISOString()
      });
    }

    // Handle interruption
    if (response.serverContent?.interrupted) {
      console.log(`⚠️ Interrupted - clearing transcriptions`);
      // Clear current transcriptions on interrupt
      session.currentInputTranscription = '';
      session.currentOutputTranscription = '';
      
      this.sendToClient(clientId, {
        type: 'interrupted',
        sessionId,
        timestamp: new Date().toISOString()
      });
    }

    // Handle go away (session ending)
    if (response.goAway) {
      this.sendToClient(clientId, {
        type: 'go_away',
        sessionId,
        timeLeft: response.goAway.timeLeft,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Accumulate transcription by concatenating fragments
   * Gemini sends small fragments that need to be joined together
   */
  accumulateTranscription(current, fragment) {
    if (!fragment) return current || '';
    if (!current) return fragment;
    // Concatenate fragments - Gemini sends small chunks
    return current + fragment;
  }

  /**
   * Keep transcription text as-is, no normalization
   */
  normalizeTranscription(text) {
    return text || '';
  }

  /**
   * Save turn messages (after turnComplete)
   */
  async saveTurnMessages(clientId, sessionId) {
    const client = this.clients.get(clientId);
    if (!client?.session) return;

    const session = client.session;
    const conversationId = session.conversationId;

    try {
      const conversation = await Conversation.findOne({ conversationId });
      if (!conversation) return;

      // Save input transcription as USER message
      const inputText = this.normalizeTranscription(session.currentInputTranscription);
      if (inputText) {
        const messageSequence = conversation.getNextMessageSequence();
        await conversation.save();

        const userMessage = new Message({
          messageId: uuidv4(),
          conversationId,
          userId: session.userId,
          messageSequence,
          messageType: 'live',
          role: 'user',
          content: { text: inputText },
          config: {
            live: {
              model: session.model,
              sessionId: session.id,
              responseModalities: ['AUDIO']
            }
          },
          status: 'completed',
          metadata: {
            timing: { requestTime: new Date() },
            provider: { name: 'google', sessionId: session.id }
          }
        });

        await userMessage.save();
        await conversation.incrementStats('live');
        console.log(`💾 Saved USER message: "${inputText.substring(0, 50)}..."`);
      }

      // Save output transcription as MODEL message
      const outputText = this.normalizeTranscription(session.currentOutputTranscription);
      if (outputText) {
        const messageSequence = conversation.getNextMessageSequence();
        await conversation.save();

        const modelMessage = new Message({
          messageId: uuidv4(),
          conversationId,
          userId: session.userId,
          messageSequence,
          messageType: 'live',
          role: 'model',
          content: { text: outputText },
          config: {
            live: {
              model: session.model,
              sessionId: session.id,
              responseModalities: ['AUDIO']
            }
          },
          status: 'completed',
          metadata: {
            timing: { requestTime: new Date() },
            provider: { name: 'google', sessionId: session.id }
          }
        });

        await modelMessage.save();
        await conversation.incrementStats('live');
        console.log(`💾 Saved MODEL message: "${outputText.substring(0, 50)}..."`);
      }

      // Clear accumulators for next turn
      session.currentInputTranscription = '';
      session.currentOutputTranscription = '';

    } catch (error) {
      console.error('Error saving turn messages:', error);
    }
  }

  /**
   * Save any pending messages before session ends
   */
  async saveSessionMessages(clientId, sessionId) {
    const client = this.clients.get(clientId);
    if (!client?.session) return;

    // Save any remaining transcriptions
    await this.saveTurnMessages(clientId, sessionId);
  }

  /**
   * Handle text message from user
   */
  async handleSendText(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client?.session) {
      return this.sendError(clientId, 'No active session');
    }

    const { text } = message.data || message;
    if (!text) {
      return this.sendError(clientId, 'Text is required');
    }

    try {
      // Save the user text message to conversation immediately
      await this.saveUserTextMessage(clientId, text);

      // Send text to Gemini via sendClientContent
      await client.session.geminiSession.sendClientContent({
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true
      });

      console.log(`📤 Sent text to Gemini: "${text.substring(0, 50)}..."`);

    } catch (error) {
      console.error('Send text error:', error);
      this.sendError(clientId, `Failed to send text: ${error.message}`);
    }
  }

  /**
   * Save user text message to conversation
   */
  async saveUserTextMessage(clientId, text) {
    const client = this.clients.get(clientId);
    if (!client?.session) return;

    const session = client.session;
    const conversationId = session.conversationId;

    try {
      const conversation = await Conversation.findOne({ conversationId });
      if (!conversation) return;

      const messageSequence = conversation.getNextMessageSequence();
      await conversation.save();

      const userMessage = new Message({
        messageId: uuidv4(),
        conversationId,
        userId: session.userId,
        messageSequence,
        messageType: 'live',
        role: 'user',
        content: { text },
        config: {
          live: {
            model: session.model,
            sessionId: session.id,
            responseModalities: ['AUDIO'],
            inputType: 'text'
          }
        },
        status: 'completed',
        metadata: {
          timing: { requestTime: new Date() },
          provider: { name: 'google', sessionId: session.id }
        }
      });

      await userMessage.save();
      await conversation.incrementStats('live');
      console.log(`💾 Saved USER TEXT: "${text.substring(0, 50)}..."`);

    } catch (error) {
      console.error('Error saving user text message:', error);
    }
  }

  /**
   * Handle audio data from user
   */
  async handleSendAudio(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client?.session) {
      return this.sendError(clientId, 'No active session');
    }

    const { data, mimeType = 'audio/pcm;rate=16000' } = message.data || {};
    if (!data) {
      return this.sendError(clientId, 'Audio data is required');
    }

    try {
      await client.session.geminiSession.sendRealtimeInput({
        audio: { data, mimeType }
      });
    } catch (error) {
      console.error('Send audio error:', error);
      this.sendError(clientId, `Failed to send audio: ${error.message}`);
    }
  }

  /**
   * Handle video frame from user (real-time vision)
   */
  async handleSendVideo(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client?.session) {
      return this.sendError(clientId, 'No active session');
    }

    const { data, mimeType = 'image/jpeg' } = message.data || {};
    if (!data) {
      return this.sendError(clientId, 'Video frame data is required');
    }

    try {
      // Send video frame as realtime input to Gemini
      await client.session.geminiSession.sendRealtimeInput({
        video: { data, mimeType }
      });
    } catch (error) {
      console.error('Send video error:', error);
      // Don't spam errors for video frames - just log
    }
  }

  /**
   * Handle sending conversation context (incremental updates)
   * This loads previous conversation history into the Gemini session
   */
  async handleSendContext(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client?.session) {
      return this.sendError(clientId, 'No active session');
    }

    const { turns, turnComplete = true } = message.data || {};
    if (!turns || !Array.isArray(turns) || turns.length === 0) {
      console.log('📝 No context turns to send');
      return;
    }

    try {
      console.log(`📝 Sending ${turns.length} conversation context turns to Gemini`);
      
      // Send conversation history using sendClientContent
      await client.session.geminiSession.sendClientContent({
        turns: turns,
        turnComplete: turnComplete
      });
      
      console.log(`✅ Conversation context loaded successfully`);
      
      // Notify client that context was loaded
      this.sendToClient(clientId, {
        type: 'context_loaded',
        messageCount: turns.length,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Send context error:', error);
      this.sendError(clientId, `Failed to load context: ${error.message}`);
    }
  }

  /**
   * Handle raw binary audio data
   */
  async handleAudioData(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client?.session) return;

    try {
      const base64Data = Buffer.isBuffer(data) 
        ? data.toString('base64') 
        : Buffer.from(data).toString('base64');

      await client.session.geminiSession.sendRealtimeInput({
        audio: {
          data: base64Data,
          mimeType: 'audio/pcm;rate=16000'
        }
      });
    } catch (error) {
      console.error('Audio data error:', error);
    }
  }

  /**
   * Handle session end
   */
  async handleEndSession(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client?.session) {
      return this.sendError(clientId, 'No active session');
    }

    const sessionId = client.session.id;

    try {
      // Save any pending messages
      await this.saveSessionMessages(clientId, sessionId);

      // Close Gemini session
      client.session.geminiSession.close();

      // Update conversation
      const conversation = await Conversation.findOne({ 
        conversationId: client.session.conversationId 
      });
      if (conversation) {
        conversation.session.isLiveActive = false;
        await conversation.save();
      }

      // Cleanup
      this.sessionManager.removeSession(sessionId);
      client.session = null;

      this.sendToClient(clientId, {
        type: 'session_ended',
        sessionId,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Session ended: ${sessionId}`);

    } catch (error) {
      console.error('End session error:', error);
      this.sendError(clientId, `Failed to end session: ${error.message}`);
    }
  }

  /**
   * Handle client disconnection
   */
  async handleDisconnection(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    console.log(`🔌 Client disconnected: ${clientId}`);

    if (client.session) {
      try {
        await this.saveSessionMessages(clientId, client.session.id);
        client.session.geminiSession.close();
        this.sessionManager.removeSession(client.session.id);
      } catch (error) {
        console.error(`Error closing session for ${clientId}:`, error);
      }
    }

    this.clients.delete(clientId);
  }

  /**
   * Handle WebSocket error
   */
  handleError(clientId, error) {
    console.error(`WebSocket error for ${clientId}:`, error);
    this.sendError(clientId, 'WebSocket error');
  }

  /**
   * Send message to client
   */
  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== 1) return;

    try {
      client.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(`Failed to send to ${clientId}:`, error);
    }
  }

  /**
   * Send error to client
   */
  sendError(clientId, errorMessage) {
    this.sendToClient(clientId, {
      type: 'error',
      error: errorMessage,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Setup heartbeat
   */
  setupHeartbeat(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const interval = setInterval(() => {
      if (client.ws.readyState !== 1) {
        clearInterval(interval);
        return;
      }

      // Check for timeout
      const timeout = parseInt(process.env.SESSION_TIMEOUT) || 900000; // 15 min
      if (Date.now() - client.lastActivity.getTime() > timeout) {
        console.log(`Session timeout for ${clientId}`);
        if (client.session) {
          this.handleEndSession(clientId, {});
        }
        return;
      }

      this.sendToClient(clientId, { type: 'ping', timestamp: new Date().toISOString() });
    }, 30000);
  }

  /**
   * Get server stats
   */
  getStats() {
    return {
      connectedClients: this.clients.size,
      activeSessions: this.sessionManager.getSessionStats()
    };
  }
}

/**
 * Setup WebSocket server
 */
export async function setupLiveApiServer(wss) {
  const liveApiService = new LiveApiService();
  await liveApiService.initialize();

  wss.on('connection', (ws, req) => {
    liveApiService.handleConnection(ws, req);
  });

  wss.getStats = () => liveApiService.getStats();

  console.log('✅ Live API WebSocket server ready');
  return liveApiService;
}

