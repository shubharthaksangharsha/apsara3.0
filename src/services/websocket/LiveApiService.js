
import { v4 as uuidv4 } from 'uuid';
import { liveApiRateLimiter, liveApiUserRateLimiter, getLiveApiLimitInfo } from '../../middleware/rateLimiter.js';
import ProviderManager from '../../providers/ProviderManager.js';
import { LiveSessionManager } from './LiveSessionManager.js';
import { Conversation, Message } from '../../models/index.js';
import ConversationService from '../database/ConversationService.js';
import {MediaResolution} from '@google/genai';

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
    } catch (error) {
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
          // Unknown message type - ignore
      }
    } catch (error) {
      this.sendError(clientId, error.message);
    }
  }

  /**
   * Handle session creation
   * Creates a Gemini Live session with AUDIO response modality and transcription enabled
   */
  async handleCreateSession(clientId, message) {
    console.log(`\n📝 ====== CREATE SESSION START ======`);
    console.log(`📝 ClientId: ${clientId}`);
    console.log(`📝 Message data:`, JSON.stringify(message.data || {}, null, 2));
    
    try {
      const {
        model = 'gemini-2.5-flash-native-audio-preview-09-2025',
        conversationId = null,
        userId,
        systemInstruction = null,
        voice = 'Aoede',
        language = 'en-US'
      } = message.data || {};

      console.log(`📝 Parsed: model=${model}, userId=${userId}, voice=${voice}, language=${language}`);

      if (!userId) {
        console.log(`❌ No userId provided`);
        return this.sendError(clientId, 'userId is required');
      }

      // Get user to check for personalization preferences
      const User = (await import('../../models/User.js')).default;
      const user = await User.findById(userId);
      
      // Use user's preferred voice if available, otherwise use provided or default
      let finalVoice = voice;
      if (user?.preferences?.selectedVoice) {
        finalVoice = user.preferences.selectedVoice;
        console.log(`🎤 Using user's preferred voice: ${finalVoice}`);
      }

      const client = this.clients.get(clientId);
      
      // User-based rate limiting for Live API sessions
      const rateLimitResult = await liveApiUserRateLimiter(userId, client?.ip);
      if (!rateLimitResult.success) {
        console.log(`❌ Live API rate limit exceeded for user: ${userId}`);
        this.sendToClient(clientId, {
          type: 'rate_limit_exceeded',
          error: rateLimitResult.message,
          retryAfter: rateLimitResult.retryAfter,
          limit: rateLimitResult.limit,
          limitType: rateLimitResult.limitType || 'daily'
        });
        return;
      }
      
      const sessionId = uuidv4();
      console.log(`📝 Generated sessionId: ${sessionId}, remaining sessions: ${rateLimitResult.remainingPoints}/${rateLimitResult.limit}`);


      // Create or get conversation
      let finalConversationId = conversationId;
      if (!conversationId) {
        // Create new conversation
        const conversation = await ConversationService.createConversation(userId, 'live', {
          liveModel: model,
          responseModalities: ['AUDIO']
        });
        finalConversationId = conversation.conversationId;
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
              client.pendingContext = contextTurns;
            }
          }
        } catch (contextError) {
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
              voiceName: finalVoice
            }
          },
          languageCode: language
        },
        // Enable transcriptions - this is key for saving conversation history
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        // Use LOW media resolution for faster video/image processing
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
      };

      // Build conversation context summary for system instruction
      let contextSummary = '';
      if (client.pendingContext && client.pendingContext.length > 0) {
        contextSummary = '\n\n=== PREVIOUS CONVERSATION HISTORY ===\nThe user has spoken with you before. Here is the conversation history:\n';
        client.pendingContext.forEach((turn, i) => {
          const role = turn.role === 'user' ? 'User' : 'You (Apsara)';
          const text = turn.parts?.[0]?.text || '';
          contextSummary += `\n${role}: ${text}`;
        });
        contextSummary += '\n\n=== END OF HISTORY ===\nContinue the conversation naturally. If the user asks about previous discussions, refer to the history above.\n';
      }

      // Add custom system instructions from user preferences
      let customInstructionsSummary = '';
      if (user?.preferences?.customSystemInstructions) {
        const customInstructions = user.preferences.customSystemInstructions.trim();
        if (customInstructions) {
          customInstructionsSummary = `\n\n=== USER'S CUSTOM INSTRUCTIONS ===\nThe user has provided these custom instructions for how you should behave:\n${customInstructions}\n\nPlease follow these instructions while maintaining your core personality.\n`;
          console.log(`📝 Using custom system instructions from user preferences`);
        }
      }

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

=== OBJECT DETECTION & HIGHLIGHTING CAPABILITY ===
You have the ability to detect and highlight objects in the user's camera or screen share feed.

If the user asks you to find, locate, identify, highlight, mark, point out, show, or detect any object (for example: "Where is the fan?", "Highlight the laptop", "Show me my shoes", "Mark the charger", "Point to the door", "Find my keys", "Where are my glasses?"), then you MUST:

1. Look at the current video/camera frame carefully
2. Identify the object(s) the user is asking about
3. Call the "highlighter" function with the bounding box coordinates
4. The bounding box coordinates should be normalized (0-1000 scale) where:
   - y_min, x_min = top-left corner of the bounding box (format: [y_min, x_min, y_max, x_max])
   - y_max, x_max = bottom-right corner of the bounding box
   - All values are relative to the frame dimensions (0 = left/top edge, 1000 = right/bottom edge)

5. If you find multiple instances of the object, return ALL of them in the array
6. If you cannot find the object, return an empty array and tell the user you couldn't locate it
7. Always verbally acknowledge what you found while calling the function

Example function call for finding a laptop and a phone:
highlighter({ objects: [
  { "label": "laptop", "box_2d": [120, 200, 450, 500] },
  { "label": "phone", "box_2d": [600, 300, 700, 450] }
]})

The Apsara app will overlay these bounding boxes on the user's live camera/video feed to show them exactly where the objects are.

=== VOICE & SPEED ADAPTATION ===
You have native capability to change your voice and speaking speed based on user requests. If a user asks you to speak in a different voice, tone, or style (for example: "answer in a spooky whispering voice", "speak faster", "talk like a robot", "use a cheerful voice", "whisper this", "speak slowly"), you should adapt your voice and delivery style accordingly. This is a native feature of your voice system, so you can naturally adjust your tone, pace, and speaking style to match the user's request.

Remember: You're having a real-time voice conversation, so keep responses natural and flowing.${customInstructionsSummary}${contextSummary}`
        }]
      };
      
      liveConfig.systemInstruction = apsaraSystemInstruction;
      
      // Define the highlighter function for object detection
      const highlighterFunction = {
        name: "highlighter",
        description: "Highlights and marks objects in the user's camera or screen share feed by drawing bounding boxes around detected objects. Use this when the user asks to find, locate, identify, highlight, mark, point out, show, or detect any object in the video/camera feed.",
        parameters: {
          type: "object",
          properties: {
            objects: {
              type: "array",
              description: "Array of detected objects with their labels and bounding box coordinates",
              items: {
                type: "object",
                properties: {
                  label: {
                    type: "string",
                    description: "Name/label of the detected object (e.g., 'laptop', 'phone', 'cup')"
                  },
                  box_2d: {
                    type: "array",
                    description: "Bounding box coordinates as [y_min, x_min, y_max, x_max] normalized to 0-1000 scale",
                    items: {
                      type: "number"
                    },
                    minItems: 4,
                    maxItems: 4
                  }
                },
                required: ["label", "box_2d"]
              }
            }
          },
          required: ["objects"]
        }
      };
      
      // Add Google Search tool and highlighter function for real-time information
      liveConfig.tools = [
        { googleSearch: {} },
        { functionDeclarations: [highlighterFunction] }
      ];

      // Create Gemini Live session
      // Note: We need to send context AFTER the session is stored, not in onopen
      // because liveSession isn't assigned yet during the callback
      console.log(`🔌 Attempting to connect to Gemini Live API for session ${sessionId}...`);
      console.log(`🔌 Calling ProviderManager.createLiveSession()...`);
      const liveSessionStartTime = Date.now();
      
      const liveSession = await ProviderManager.createLiveSession({
        model,
        provider: 'google',
        config: liveConfig,
        callbacks: {
          onopen: async () => {
            console.log(`🟢 Gemini Live session OPENED for session ${sessionId} (took ${Date.now() - liveSessionStartTime}ms)`);
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
            console.error(`🔴 Gemini Live session ERROR for session ${sessionId}:`, error);
            this.sendToClient(clientId, {
              type: 'session_error',
              sessionId,
              error: error.message || String(error),
              timestamp: new Date().toISOString()
            });
          },
          
          onclose: async (reason) => {
            console.log(`🟠 Gemini Live session CLOSED for session ${sessionId}:`, reason);
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
      console.log(`✅ Gemini Live connect() returned for session ${sessionId} (took ${Date.now() - liveSessionStartTime}ms)`);
      console.log(`✅ liveSession object:`, liveSession ? 'exists' : 'null/undefined');

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

      // Context already included in system instruction
      if (client.pendingContext && client.pendingContext.length > 0) {
        const count = client.pendingContext.length;
        delete client.pendingContext;
        this.sendToClient(clientId, { type: 'context_loaded', count, timestamp: new Date().toISOString() });
      }

      this.sendToClient(clientId, {
        type: 'session_created',
        sessionId,
        conversationId: finalConversationId,
        model,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      this.sendError(clientId, `Failed to create session: ${error.message}`);
    }
  }

  /**
   * Handle Gemini Live API messages - optimized for low latency
   */
  async handleGeminiMessage(clientId, sessionId, response) {
    const client = this.clients.get(clientId);
    if (!client?.session) return;

    const session = client.session;
    const sc = response.serverContent;

    // Priority 0: Tool calls (function calling) - handle immediately
    if (response.toolCall) {
      console.log('[LiveAPI] Tool call received:', JSON.stringify(response.toolCall, null, 2));
      await this.handleToolCall(clientId, sessionId, response.toolCall);
    }

    // Priority 1: Audio data - send immediately for lowest latency
    if (response.data) {
      this.sendToClient(clientId, { type: 'audio_data', sessionId, data: response.data });
    } else if (sc?.modelTurn?.parts?.[0]?.inlineData?.data) {
      const part = sc.modelTurn.parts[0];
      if (part.inlineData.mimeType?.startsWith('audio/')) {
        this.sendToClient(clientId, { type: 'audio_data', sessionId, data: part.inlineData.data });
      }
    }

    // Priority 2: Transcriptions
    if (sc?.inputTranscription?.text) {
      session.currentInputTranscription += sc.inputTranscription.text;
      this.sendToClient(clientId, { type: 'input_transcription', sessionId, text: session.currentInputTranscription });
    }

    if (sc?.outputTranscription?.text) {
      session.currentOutputTranscription += sc.outputTranscription.text;
      this.sendToClient(clientId, { type: 'output_transcription', sessionId, text: session.currentOutputTranscription });
    }

    // Priority 3: Turn/Generation events - save async (don't block)
    if (sc?.turnComplete) {
      this.saveTurnMessages(clientId, sessionId); // No await - fire and forget
      this.sendToClient(clientId, { type: 'turn_complete', sessionId });
    }

    if (sc?.generationComplete) {
      if (session.currentOutputTranscription || session.currentInputTranscription) {
        this.saveTurnMessages(clientId, sessionId);
      }
      this.sendToClient(clientId, { type: 'generation_complete', sessionId });
    }

    if (sc?.interrupted) {
      session.currentInputTranscription = '';
      session.currentOutputTranscription = '';
      this.sendToClient(clientId, { type: 'interrupted', sessionId });
    }

    if (response.goAway) {
      this.sendToClient(clientId, { type: 'go_away', sessionId, timeLeft: response.goAway.timeLeft });
    }
  }

  /**
   * Handle tool calls from Gemini (function calling)
   * Processes function calls and sends responses back to the model
   */
  async handleToolCall(clientId, sessionId, toolCall) {
    const client = this.clients.get(clientId);
    if (!client?.session) return;

    const session = client.session;
    const functionResponses = [];

    console.log('[LiveAPI] Processing tool call for session:', sessionId);

    for (const fc of toolCall.functionCalls || []) {
      console.log(`[LiveAPI] Function called: ${fc.name}`);
      console.log(`[LiveAPI] Function args:`, JSON.stringify(fc.args, null, 2));

      if (fc.name === 'highlighter') {
        // Handle highlighter function - send bounding boxes to client
        const objects = fc.args?.objects || [];
        
        console.log(`[LiveAPI] Highlighter called with ${objects.length} objects:`, objects);
        
        // Send highlight data to client for overlay rendering
        this.sendToClient(clientId, {
          type: 'highlight_objects',
          sessionId,
          objects: objects.map(obj => ({
            label: obj.label,
            box_2d: obj.box_2d // [y_min, x_min, y_max, x_max] normalized 0-1000
          })),
          timestamp: new Date().toISOString()
        });

        // Send function response back to model
        functionResponses.push({
          id: fc.id,
          name: fc.name,
          response: { 
            result: "success",
            message: `Highlighted ${objects.length} object(s) on the user's screen`,
            objects_highlighted: objects.map(o => o.label)
          }
        });
      } else {
        // Unknown function - send generic response
        console.log(`[LiveAPI] Unknown function: ${fc.name}`);
        functionResponses.push({
          id: fc.id,
          name: fc.name,
          response: { result: "error", message: "Unknown function" }
        });
      }
    }

    // Send tool responses back to Gemini
    if (functionResponses.length > 0) {
      try {
        console.log('[LiveAPI] Sending tool responses:', JSON.stringify(functionResponses, null, 2));
        await session.geminiSession.sendToolResponse({ functionResponses });
      } catch (error) {
        console.error('[LiveAPI] Error sending tool response:', error.message);
      }
    }
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
      const inputText = session.currentInputTranscription?.trim();
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
      }

      // Save output transcription as MODEL message
      const outputText = session.currentOutputTranscription?.trim();
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
      }

      // Clear accumulators for next turn
      session.currentInputTranscription = '';
      session.currentOutputTranscription = '';

    } catch (error) {
      // Error saving turn messages
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
    } catch (error) {
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
    } catch (error) {
      // Error saving user text
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
      // Audio send error - don't spam client
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
      console.log(`[LiveAPI] Sending video frame: ${data.length} chars, mimeType: ${mimeType}`);
      await client.session.geminiSession.sendRealtimeInput({
        video: { data, mimeType }
      });
      console.log(`[LiveAPI] Video frame sent successfully`);
    } catch (error) {
      console.error(`[LiveAPI] Video send error:`, error.message);
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
    if (!turns || !Array.isArray(turns) || turns.length === 0) return;

    try {
      await client.session.geminiSession.sendClientContent({
        turns: turns,
        turnComplete: turnComplete
      });
      
      this.sendToClient(clientId, {
        type: 'context_loaded',
        messageCount: turns.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
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
      // Audio data error - silent
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
    } catch (error) {
      this.sendError(clientId, `Failed to end session: ${error.message}`);
    }
  }

  /**
   * Handle client disconnection
   */
  async handleDisconnection(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (client.session) {
      try {
        await this.saveSessionMessages(clientId, client.session.id);
        client.session.geminiSession.close();
        this.sessionManager.removeSession(client.session.id);
      } catch (error) {
        // Cleanup error
      }
    }

    this.clients.delete(clientId);
  }

  /**
   * Handle WebSocket error
   */
  handleError(clientId, error) {
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
      // Send error
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
        if (client.session) this.handleEndSession(clientId, {});
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
