# Live API Usage Examples

This document shows how to use the updated Apsara Live API with the new message structure.

## WebSocket Connection

```javascript
const ws = new WebSocket('ws://localhost:3000/live');
```

## 1. Creating a Session

### Basic Session
```javascript
ws.send(JSON.stringify({
  type: 'create_session',
  data: {
    model: 'gemini-live-2.5-flash-preview', // Half-cascade model
    config: {
      responseModalities: ['TEXT']
    }
  }
}));
```

### Native Audio Session
```javascript
ws.send(JSON.stringify({
  type: 'create_session',
  data: {
    model: 'gemini-2.5-flash-preview-native-audio-dialog', // Native audio
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { 
          prebuiltVoiceConfig: { voiceName: "Kore" } 
        }
      },
      enableAffectiveDialog: true,
      proactivity: { proactiveAudio: true }
    }
  }
}));
```

### Session with Resumption Support
```javascript
ws.send(JSON.stringify({
  type: 'create_session',
  data: {
    model: 'gemini-live-2.5-flash-preview',
    resumeHandle: previousSessionHandle, // from previous session
    config: {
      responseModalities: ['TEXT'],
      sessionResumption: {},
      contextWindowCompression: { slidingWindow: {} }
    }
  }
}));
```

## 2. Sending Messages

### Text Message
```javascript
ws.send(JSON.stringify({
  type: 'send_message',
  data: {
    sessionId: 'your-session-id',
    text: 'Hello, how are you today?',
    turnComplete: true
  }
}));
```

### Message with File
```javascript
ws.send(JSON.stringify({
  type: 'send_message',
  data: {
    sessionId: 'your-session-id',
    text: 'Please analyze this image',
    file: {
      uri: 'files/uploaded-file-id',
      mimeType: 'image/jpeg'
    },
    turnComplete: true
  }
}));
```

### Message with Inline Data
```javascript
ws.send(JSON.stringify({
  type: 'send_message',
  data: {
    sessionId: 'your-session-id',
    text: 'What do you see in this image?',
    file: {
      data: base64ImageData,
      mimeType: 'image/jpeg'
    },
    turnComplete: true
  }
}));
```

## 3. Realtime Input

### Audio Input
```javascript
ws.send(JSON.stringify({
  type: 'send_realtime_input',
  data: {
    sessionId: 'your-session-id',
    audio: {
      data: base64AudioData,
      mimeType: 'audio/pcm;rate=16000'
    }
  }
}));
```

### Video Input
```javascript
ws.send(JSON.stringify({
  type: 'send_realtime_input',
  data: {
    sessionId: 'your-session-id',
    video: {
      data: base64VideoData,
      mimeType: 'video/mp4'
    }
  }
}));
```

### Image Input
```javascript
ws.send(JSON.stringify({
  type: 'send_realtime_input',
  data: {
    sessionId: 'your-session-id',
    image: {
      data: base64ImageData,
      mimeType: 'image/jpeg'
    }
  }
}));
```

### Audio Stream Control
```javascript
// End audio stream
ws.send(JSON.stringify({
  type: 'send_realtime_input',
  data: {
    sessionId: 'your-session-id',
    audioStreamEnd: true
  }
}));

// Manual activity detection
ws.send(JSON.stringify({
  type: 'send_realtime_input',
  data: {
    sessionId: 'your-session-id',
    activityStart: true
  }
}));

ws.send(JSON.stringify({
  type: 'send_realtime_input',
  data: {
    sessionId: 'your-session-id',
    activityEnd: true
  }
}));
```

## 4. Incremental Content Updates

### Short Context Restoration
```javascript
ws.send(JSON.stringify({
  type: 'send_incremental_update',
  data: {
    sessionId: 'your-session-id',
    turns: [
      { "role": "user", "parts": [{ "text": "What is the capital of France?" }] },
      { "role": "model", "parts": [{ "text": "Paris" }] }
    ],
    turnComplete: false
  }
}));

// Continue with new input
ws.send(JSON.stringify({
  type: 'send_incremental_update',
  data: {
    sessionId: 'your-session-id',
    turns: [
      { "role": "user", "parts": [{ "text": "What is the capital of Germany?" }] }
    ],
    turnComplete: true
  }
}));
```

## 5. Function Calling

```javascript
ws.send(JSON.stringify({
  type: 'create_session',
  data: {
    model: 'gemini-live-2.5-flash-preview',
    config: {
      responseModalities: ['TEXT'],
      tools: [{
        functionDeclarations: [{
          name: 'get_weather',
          description: 'Get current weather for a location',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' }
            }
          }
        }]
      }]
    }
  }
}));

// When you receive a tool call, respond with:
ws.send(JSON.stringify({
  type: 'send_tool_response',
  data: {
    sessionId: 'your-session-id',
    functionResponses: [{
      id: 'function-call-id',
      name: 'get_weather',
      response: { 
        result: '{"temperature": 72, "conditions": "sunny"}' 
      }
    }]
  }
}));
```

## 6. Session Management Events

### Handle Session Resumption Updates
```javascript
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'session_resumption_update') {
    const newHandle = message.data.newHandle;
    // Store this handle for future session resumption
    localStorage.setItem('sessionHandle', newHandle);
  }
  
  if (message.type === 'go_away') {
    const timeLeft = message.data.timeLeft;
    console.log(`Connection will close in ${timeLeft}ms`);
    // Prepare for reconnection with stored handle
  }
  
  if (message.type === 'generation_complete') {
    console.log('AI finished generating response');
  }
};
```

## Available Models

### Half-Cascade Models (Production Ready)
- `gemini-live-2.5-flash-preview` (default)
- `gemini-2.0-flash-live-001`

### Native Audio Models (Advanced Features)
- `gemini-2.5-flash-preview-native-audio-dialog`
- `gemini-2.5-flash-exp-native-audio-thinking-dialog`

## Audio Format Requirements

- **Input Audio**: 16-bit PCM, 16kHz, mono
- **Output Audio**: 16-bit PCM, 24kHz, mono
- **MIME Type**: `audio/pcm;rate=16000` for input

## Response Modalities

- `TEXT`: Text responses only
- `AUDIO`: Audio responses only

**Note**: Only one response modality can be set per session. 