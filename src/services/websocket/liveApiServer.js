import { v4 as uuidv4 } from 'uuid';
import { liveApiRateLimiter } from '../../middleware/rateLimiter.js';
import ProviderManager from '../../providers/ProviderManager.js';
import { SessionManager } from './SessionManager.js';

/**
 * Live API WebSocket Server
 * Handles real-time streaming interactions with AI models
 */
export class LiveApiServer {
  constructor() {
    this.clients = new Map();
    this.sessionManager = new SessionManager();
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
      const {
        model = 'gemini-2.0-flash-live-001',
        provider = 'google',
        config = {},
        sessionId = uuidv4(),
        resumeHandle = null
      } = message.data || {};

      const client = this.clients.get(clientId);
      
      // Check session limits
      if (client.sessions.size >= parseInt(process.env.MAX_SESSIONS_PER_USER) || 5) {
        return this.sendError(clientId, 'Maximum number of sessions reached');
      }

      // Create live session with provider
      const sessionCallbacks = {
        onopen: () => {
          this.sendToClient(clientId, {
            type: 'session_opened',
            sessionId,
            timestamp: new Date().toISOString()
          });
        },
        
        onmessage: (response) => {
          // Handle session resumption updates
          if (response.sessionResumptionUpdate) {
            this.sendToClient(clientId, {
              type: 'session_resumption_update',
              sessionId,
              data: response.sessionResumptionUpdate,
              timestamp: new Date().toISOString()
            });
          }
          
          // Handle GoAway messages
          if (response.goAway) {
            this.sendToClient(clientId, {
              type: 'go_away',
              sessionId,
              data: response.goAway,
              timestamp: new Date().toISOString()
            });
          }
          
          // Handle generation complete
          if (response.serverContent && response.serverContent.generationComplete) {
            this.sendToClient(clientId, {
              type: 'generation_complete',
              sessionId,
              timestamp: new Date().toISOString()
            });
          }
          
          // Send all messages
          this.sendToClient(clientId, {
            type: 'session_message',
            sessionId,
            data: response,
            timestamp: new Date().toISOString()
          });
        },
        
        onerror: (error) => {
          this.sendToClient(clientId, {
            type: 'session_error',
            sessionId,
            error: error.message,
            timestamp: new Date().toISOString()
          });
        },
        
        onclose: (reason) => {
          this.sendToClient(clientId, {
            type: 'session_closed',
            sessionId,
            reason,
            timestamp: new Date().toISOString()
          });
          
          // Clean up session
          client.sessions.delete(sessionId);
          this.sessionManager.removeSession(sessionId);
        }
      };

      // Enhanced config with session management features
      const enhancedConfig = {
        ...config,
        // Enable session resumption if not explicitly disabled
        ...(resumeHandle && { sessionResumption: { handle: resumeHandle } }),
        ...(!resumeHandle && { sessionResumption: {} }),
        // Enable context window compression for longer sessions
        contextWindowCompression: config.contextWindowCompression || { slidingWindow: {} },
        // Audio transcription settings
        ...(config.responseModalities?.includes('AUDIO') && {
          outputAudioTranscription: config.outputAudioTranscription || {},
          inputAudioTranscription: config.inputAudioTranscription || {}
        })
      };

      const liveSession = await ProviderManager.createLiveSession({
        model,
        provider,
        config: enhancedConfig,
        callbacks: sessionCallbacks
      });

      // Store session
      client.sessions.set(sessionId, {
        id: sessionId,
        session: liveSession.session,
        model,
        provider,
        createdAt: new Date(),
        lastActivity: new Date()
      });

      this.sessionManager.addSession(sessionId, {
        clientId,
        session: liveSession.session,
        model,
        provider
      });

      this.sendToClient(clientId, {
        type: 'session_created',
        sessionId,
        model,
        provider,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Create session error:', error);
      this.sendError(clientId, `Failed to create session: ${error.message}`);
    }
  }

  /**
   * Handle sending messages to a session
   */
  async handleSendMessage(clientId, message) {
    try {
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
      } else {
        // Handle structured message format: { type: 'send_message', data: { ... } }
        const data = message.data || {};
        sessionId = data.sessionId;
        text = data.text;
        file = data.file;
        turnComplete = data.turnComplete !== undefined ? data.turnComplete : true;
      }
      
      const client = this.clients.get(clientId);
      const sessionData = client.sessions.get(sessionId);
      
      if (!sessionData) {
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
export function setupWebSocketServer(wss) {
  const liveApiServer = new LiveApiServer();

  wss.on('connection', (ws, req) => {
    liveApiServer.handleConnection(ws, req);
  });

  // Add server stats endpoint
  wss.getStats = () => liveApiServer.getStats();
  wss.broadcast = (message) => liveApiServer.broadcast(message);

  console.log('✅ Live API WebSocket server configured');
  
  return liveApiServer;
} 