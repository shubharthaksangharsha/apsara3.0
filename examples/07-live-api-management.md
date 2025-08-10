# Live API Integration & Management Examples

This guide shows how to work with Apsara's Live API integration for real-time voice and video conversations with Google Gemini Live.

## 🎯 Overview

Apsara's Live API integration provides:
- **Real-time Voice Conversations**: Natural speech interactions with Gemini
- **MongoDB Conversation Integration**: All Live messages stored in unified conversation history
- **Unified Conversation History**: Mix REST and Live messages in the same conversation thread
- **Audio Storage**: Automatic recording and playback of voice messages (local + S3 placeholder)
- **Context Bridging**: Load REST conversation history into Live sessions
- **User & Conversation Management**: Create new or link to existing conversations

### 🎙️ Live API Features

- **Voice Interactions**: Speak naturally with Gemini using WebSocket connections
- **Context Awareness**: Continue any REST conversation in Live mode
- **Audio Recording**: Automatic save to `uploads/audio/` with transcription
- **Session Management**: Resume conversations across disconnections
- **Multimodal Support**: Text, audio, video, and screen sharing capabilities

## Prerequisites

- Apsara backend running on `http://localhost:5000`
- WebSocket server active at `ws://localhost:5000/live`
- Valid user account with conversation created
- Google Gemini Live API access

## 🗄️ MongoDB Conversation Integration

### Conversation Types

Apsara supports unified conversation management:

```javascript
const conversationTypes = {
  'rest': 'Traditional API-based conversations',
  'live': 'Real-time voice/video conversations',
  'hybrid': 'Mixed REST and Live messages' // Auto-detected
};
```

### Creating Live Conversations

#### Option 1: CLI Management
```bash
npm run manage
# Choose: 23. Create New Live Conversation
```

#### Option 2: Automatic Creation
```javascript
// Live API automatically creates conversation if none provided
const sessionMessage = {
  type: 'create_session',
  data: {
    model: 'gemini-2.0-flash-live-001',
    userId: 'user123',  // Required
    // conversationId: null  // Will create new conversation
    config: { /* session config */ }
  }
};
```

#### Option 3: Link to Existing Conversation
```javascript
const sessionMessage = {
  type: 'create_session',
  data: {
    model: 'gemini-2.0-flash-live-001',
    userId: 'user123',
    conversationId: 'conv_abc123',  // Existing conversation
    loadConversationContext: true,   // Load message history
    config: { /* session config */ }
  }
};
```

## 1. Live API Configuration

### Available Live Models

```javascript
const liveModels = [
  'gemini-2.0-flash-live-001',  // Latest Live model
  'gemini-2.0-flash-live-002'   // Future versions
];
```

### Response Modalities

```javascript
const responseModalities = {
  TEXT_ONLY: ['TEXT'],
  AUDIO_ONLY: ['AUDIO'], 
  MULTIMODAL: ['TEXT', 'AUDIO']  // Recommended
};
```

### Media Resolution Options

```javascript
const mediaResolution = {
  LOW: 'LOW',        // 480p, lower bandwidth
  MEDIUM: 'MEDIUM',  // 720p, balanced (default)
  HIGH: 'HIGH'       // 1080p, high quality
};
```

### Voice Configuration

```javascript
// Recommended: omit voiceConfig to let Gemini choose a default voice
// If you want to target a specific voice, use a valid prebuilt voice name
const voiceConfig = {
  voiceName: 'Aoede',       // Example valid prebuilt voice
  languageCode: 'en-US',    // Language preference
  speakingRate: 1.0,        // Speech speed
  pitch: 0.0,               // Voice pitch
  volumeGainDb: 0.0         // Volume adjustment
};
```

Notes:
- If you previously used `voiceName: 'auto'` and saw an error like "Requested voice api_name 'auto' is not available", remove `speechConfig` entirely or choose a valid `voiceName` (e.g., `Aoede`).

## 2. WebSocket Connection Setup

### Basic Connection

```javascript
// Connect to Live API WebSocket
const ws = new WebSocket('ws://localhost:5000/live');

ws.onopen = () => {
  console.log('🔗 Connected to Live API');
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('📥 Received:', message);
};

ws.onerror = (error) => {
  console.error('❌ WebSocket error:', error);
};

ws.onclose = () => {
  console.log('🔌 Disconnected from Live API');
};
```

### Create Live Session

```javascript
// Create session with conversation linking
const createSessionMessage = {
  type: 'create_session',
  data: {
    conversationId: 'existing_conv_123',      // Link to REST conversation
    userId: 'user_456',
    model: 'gemini-2.0-flash-live-001',
    config: {
      // Current tester supports selecting a single response modality
      responseModalities: ['TEXT'], // or ['AUDIO']
      mediaResolution: 'MEDIUM'
      // Tip: Omit speechConfig to use default voice. To force a voice:
      // speechConfig: { voiceConfig: { voiceName: 'Aoede', languageCode: 'en-US' } }
    },
    loadConversationContext: true              // Load REST history
  }
};

ws.send(JSON.stringify(createSessionMessage));
```

**Response:**
```json
{
  "type": "session_created",
  "sessionId": "live_session_789",
  "model": "gemini-2.0-flash-live-001",
  "provider": "google",
  "conversationId": "existing_conv_123",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Incremental Context Bridging (Turns)

When `loadConversationContext: true` is set and you pass a valid `conversationId`, the server loads prior REST messages into the Live session using incremental content updates. Internally it:

- Reads up to the last 20 messages for the conversation
- Converts them to Gemini Live "turns" format: `{ role: 'user' | 'model', parts: [{ text: '...'}] }`
- Sends them in batches of 10 turns with `turnComplete` set to `false` for all but the final batch

Example of the format used under the hood:

```javascript
const turns = [
  { role: 'user',  parts: [{ text: 'Hello' }] },
  { role: 'model', parts: [{ text: 'Hi! How can I help?' }] }
];

// Sent via session.sendClientContent({ turns, turnComplete })
```

This mirrors the Gemini Live guidance on incremental updates and ensures the live session inherits conversation context.

### Load Conversation Context

```json
{
  "type": "context_loaded",
  "sessionId": "live_session_789", 
  "conversationId": "existing_conv_123",
  "messagesLoaded": 5,
  "turnsLoaded": 10,
  "timestamp": "2024-01-15T10:30:01.000Z"
}
```

## 3. Sending Messages

### Text Message

```javascript
const textMessage = {
  type: 'send_message',
  sessionId: 'live_session_789',
  data: {
    text: 'Hello! Can you help me with my project?',
    turnComplete: true
  }
};

ws.send(JSON.stringify(textMessage));
```

### Audio Message (Simulated)

```javascript
// In a real implementation, this would be audio data
const audioMessage = {
  type: 'send_message',
  sessionId: 'live_session_789',
  data: {
    audioChunk: base64AudioData,    // Base64 encoded audio
    turnComplete: false             // Streaming audio
  }
};

ws.send(JSON.stringify(audioMessage));
```

### Screen Sharing

```javascript
const screenMessage = {
  type: 'send_message',
  sessionId: 'live_session_789',
  data: {
    screenData: base64ScreenData,   // Screen capture
    text: 'Can you help me understand this interface?',
    turnComplete: true
  }
};

ws.send(JSON.stringify(screenMessage));
```

## 4. Receiving AI Responses

### Text Response

```json
{
  "type": "session_message",
  "sessionId": "live_session_789",
  "data": {
    "serverContent": {
      "modelTurn": {
        "parts": [
          {
            "text": "Hello! I'd be happy to help you with your project. What specific area would you like assistance with?"
          }
        ]
      }
    }
  },
  "timestamp": "2024-01-15T10:30:05.000Z"
}
```

### Audio Response

```json
{
  "type": "session_message",
  "sessionId": "live_session_789",
  "data": {
    "serverContent": {
      "modelTurn": {
        "parts": [
          {
            "inlineData": {
              "mimeType": "audio/wav",
              "data": "base64_audio_response_data"
            }
          }
        ]
      },
      "outputTranscription": {
        "text": "Hello! I'd be happy to help you with your project.",
        "confidence": 0.98,
        "language": "en"
      }
    }
  },
  "timestamp": "2024-01-15T10:30:05.000Z"
}
```

## 5. Session Management

### Session Resumption

```javascript
const resumeMessage = {
  type: 'resume_session',
  data: {
    sessionId: 'live_session_789',
    resumeHandle: 'resume_handle_abc123'
  }
};

ws.send(JSON.stringify(resumeMessage));
```

### Session ID Handling

- Apsara uses a client-generated `sessionId` for reliability. Gemini may report `N/A` for its own session identifier; this is normal and does not affect operation.
- Server logs will display both the client `sessionId` and the Gemini session identifier (if available).

### End Session

```javascript
const endMessage = {
  type: 'end_session',
  sessionId: 'live_session_789'
};

ws.send(JSON.stringify(endMessage));
```

## 6. Audio Storage Integration

### Automatic Audio Saving

```javascript
// Audio files are automatically saved when using Live API
const audioStorageConfig = {
  // Local storage (development/testing)
  local: {
    path: './uploads/audio/',
    permanent: true,
    aiCompatible: true
  },
  
  // S3 storage (production) - PLACEHOLDER
  s3: {
    bucket: 'your-audio-bucket',
    region: 'us-east-1',
    permanentStorage: true,
    implemented: false  // TODO: Implement S3 audio storage
  },
  
  // Current default: Local storage
  default: 'local'
};
```

### Audio Message Structure

```json
{
  "messageType": "live",
  "role": "user",
  "content": {
    "text": "Hello, how are you today?"
  },
  "liveContent": {
    "audioData": {
      "fileId": "audio_1735123456_abc123def",
      "url": "/api/files/audio_1735123456_abc123def/download",
      "duration": 3.5,
      "mimeType": "audio/wav"
    },
    "inputTranscription": {
      "text": "Hello, how are you today?",
      "confidence": 0.95,
      "language": "en"
    }
  },
  "config": {
    "live": {
      "model": "gemini-2.0-flash-live-001",
      "sessionId": "live_session_789",
      "responseModalities": ["TEXT", "AUDIO"]
    }
  }
}
```

## 7. CLI Integration Testing

### Using the Management CLI

```bash
# Run the management CLI
npm run manage

# Select option 21: Test Live API Integration (NEW)
# Follow the interactive prompts:
# 1. Select integration test type
# 2. Configure Live API settings
# 3. Test with simulated messages
```

### CLI Test Flow

```
🧪 Live API Integration & Test
==============================

🎯 Live API Test Options:
=========================
1. View integration status only
2. Interactive Live API Test (Text/Audio)
3. Back to main menu

Choose test option (1-3, default: 1): 2

🎙️ Interactive Live API Test
============================

⚙️ Live API Configuration:
==========================
Enter Live model (default: gemini-2.0-flash-live-001): 

📡 Response Modalities:
1. TEXT only
2. AUDIO only
3. TEXT + AUDIO (default)
Choose modality (1-3, default: 3): 3

🎥 Media Resolution:
1. LOW
2. MEDIUM (default)
3. HIGH
Choose resolution (1-3, default: 2): 2

🎤 Voice Configuration:
1. Default voice
2. Custom voice settings
Choose voice (1-2, default: 1): 1

🔗 Load Conversation Context:
Load previous messages into Live session? (y/n, default: y): y

📋 Configuration Summary:
========================
🤖 Model: gemini-2.0-flash-live-001
📡 Response Modalities: TEXT, AUDIO
🎥 Media Resolution: MEDIUM
🔗 Load Context: Yes
👤 User ID: user_456
💬 Conversation ID: conv_123
```

## 8. Advanced Features

### Context Window Compression

```javascript
const compressionConfig = {
  type: 'create_session',
  data: {
    // ... other config
    config: {
      contextWindowCompression: {
        enabled: true,
        maxTokens: 8192,
        compressionRatio: 0.5
      }
    }
  }
};
```

### Voice Activity Detection (VAD)

```javascript
const vadConfig = {
  type: 'configure_vad',
  sessionId: 'live_session_789',
  data: {
    enabled: true,
    sensitivity: 0.7,        // 0.0 - 1.0
    silenceThreshold: 500    // milliseconds
  }
};
```

### Tool Use in Live Sessions

```javascript
const toolMessage = {
  type: 'send_message',
  sessionId: 'live_session_789',
  data: {
    text: 'Calculate 15 * 23 for me',
    tools: [
      {
        name: 'calculator',
        description: 'Perform mathematical calculations'
      }
    ],
    turnComplete: true
  }
};
```

## 9. Error Handling

### Connection Errors

```javascript
ws.onerror = (error) => {
  console.error('❌ WebSocket error:', error);
  
  // Attempt reconnection
  setTimeout(() => {
    if (ws.readyState === WebSocket.CLOSED) {
      connectToLiveAPI();
    }
  }, 5000);
};
```

### Session Errors

```json
{
  "type": "session_error",
  "sessionId": "live_session_789",
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please slow down.",
    "retryAfter": 30000
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Audio Processing Errors
### Conversation Context Errors

If you see a close reason like "Request contains an invalid argument":

- Ensure `turns` contain only valid `parts` with non-empty `text` values
- Set `turnComplete: true` only on the last batch of incremental updates
- Avoid sending extremely large batches; Apsara uses a batch size of 10 turns by default
- Verify `speechConfig` is valid (or omit it). Do not set `voiceName: 'auto'`

If debugging, the server may emit `context_load_skipped` temporarily. This indicates session creation continued while context loading was disabled for diagnostics.

```json
{
  "type": "audio_error",
  "sessionId": "live_session_789",
  "error": {
    "code": "AUDIO_DECODE_FAILED",
    "message": "Cannot decode audio format",
    "supportedFormats": ["audio/wav", "audio/mp3", "audio/ogg"]
  }
}
```

## 10. Best Practices

### Performance Optimization

```javascript
// Optimal configuration for different use cases
const configs = {
  // Low bandwidth
  lowBandwidth: {
    responseModalities: ['TEXT'],
    mediaResolution: 'LOW'
  },
  
  // Voice-first experience  
  voiceFirst: {
    responseModalities: ['AUDIO'],
    mediaResolution: 'MEDIUM',
    speechConfig: {
      voiceConfig: {
        speakingRate: 1.2,  // Slightly faster
        volumeGainDb: 2.0   // Louder
      }
    }
  },
  
  // Full multimodal
  multimodal: {
    responseModalities: ['TEXT', 'AUDIO'],
    mediaResolution: 'HIGH'
  }
};
```

### Audio Quality Settings

```javascript
const audioSettings = {
  // Development/Testing
  development: {
    sampleRate: 16000,      // 16kHz
    bitRate: 64000,         // 64kbps
    channels: 1             // Mono
  },
  
  // Production
  production: {
    sampleRate: 44100,      // 44.1kHz
    bitRate: 128000,        // 128kbps  
    channels: 2             // Stereo
  }
};
```

### Session Management

```javascript
class LiveSessionManager {
  constructor() {
    this.activeSessions = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }
  
  async createSession(config) {
    // Implementation with retry logic
  }
  
  async handleDisconnection(sessionId) {
    // Save session state for resumption
    const sessionState = this.activeSessions.get(sessionId);
    if (sessionState) {
      await this.saveSessionState(sessionId, sessionState);
    }
  }
  
  async resumeSession(sessionId) {
    // Restore from saved state
    const savedState = await this.loadSessionState(sessionId);
    if (savedState) {
      return this.recreateSession(savedState);
    }
  }
}
```

## 11. Integration with REST API

### Seamless Mode Switching

```javascript
// Start with REST conversation
const restConversation = await fetch('/api/conversations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user_123',
    title: 'Mixed Mode Conversation'
  })
});

// Send REST messages
await fetch('/api/ai/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user_123',
    conversationId: 'conv_456',
    contents: 'Hello, I need help with my project'
  })
});

// Switch to Live mode (loads REST history)
const liveSession = {
  type: 'create_session',
  data: {
    conversationId: 'conv_456',  // Same conversation
    userId: 'user_123',
    loadConversationContext: true  // Loads REST messages
  }
};
```

### Unified Message History

```javascript
// View combined message history
const messages = await fetch(`/api/conversations/conv_456/messages`);

// Messages will include both types:
// - messageType: 'rest' (from REST API)
// - messageType: 'live' (from Live API)
// Both appear in chronological order
```

## 12. Production Deployment

### S3 Audio Storage Setup

```javascript
// Future S3 implementation
const s3AudioConfig = {
  bucket: 'apsara-live-audio',
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  
  // Audio file organization
  keyPattern: 'audio/{userId}/{conversationId}/{timestamp}_{messageId}.{ext}',
  
  // Lifecycle policies
  expiration: {
    deleteAfter: '90d',        // Auto-delete after 90 days
    transitionToIA: '30d',     // Move to Infrequent Access after 30 days
    transitionToGlacier: '60d' // Archive to Glacier after 60 days
  }
};
```

### WebSocket Scaling

```javascript
// Load balancing configuration
const liveApiCluster = {
  instances: 4,                    // Number of WebSocket servers
  loadBalancer: 'nginx',           // Use nginx for WebSocket load balancing
  sessionAffinity: true,           // Sticky sessions for Live API
  healthCheck: '/live/health',     // Health check endpoint
  
  // Redis for session sharing
  sessionStore: {
    type: 'redis',
    host: 'redis-cluster.local',
    port: 6379,
    ttl: 3600                      // Session TTL: 1 hour
  }
};
```

This comprehensive guide covers all aspects of Live API integration in Apsara, from basic setup to advanced production deployment strategies.