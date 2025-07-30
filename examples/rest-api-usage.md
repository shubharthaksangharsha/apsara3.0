# REST API Usage Examples

This document shows how to use the updated Apsara REST API with streaming-only responses.

## Base URL
```
http://localhost:3000/api
```

## Available Models
- `gemini-2.5-flash` (default, fast)
- `gemini-2.5-pro` (advanced reasoning)

## 1. Basic Text Generation (Streaming)

All REST API endpoints now return streaming responses by default.

```javascript
const response = await fetch('http://localhost:3000/api/ai/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: "Explain quantum computing in simple terms",
    model: "gemini-2.5-flash",
    config: {
      temperature: 0.7,
      maxOutputTokens: 1024
    }
  })
});

// Handle streaming response
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  const lines = chunk.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') {
        console.log('Stream complete');
        break;
      }
      
      try {
        const parsed = JSON.parse(data);
        if (parsed.text) {
          console.log('Chunk:', parsed.text);
        }
      } catch (e) {
        // Handle parsing errors
      }
    }
  }
}
```

## 2. Multimodal Content

### With Uploaded File
```javascript
// First upload file
const formData = new FormData();
formData.append('files', fileInput.files[0]);

const uploadResponse = await fetch('http://localhost:3000/api/files/upload', {
  method: 'POST',
  body: formData
});

const uploadResult = await uploadResponse.json();
const fileUri = uploadResult.files[0].providerResponse.uri;

// Then use in generation
const response = await fetch('http://localhost:3000/api/ai/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [
      {
        fileData: {
          mimeType: 'image/jpeg',
          fileUri: fileUri
        }
      },
      {
        text: 'Describe this image in detail'
      }
    ],
    model: "gemini-2.5-flash"
  })
});

// Handle streaming response as above...
```

### With Inline Data
```javascript
const response = await fetch('http://localhost:3000/api/ai/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64ImageData
        }
      },
      {
        text: 'What do you see in this image?'
      }
    ],
    model: "gemini-2.5-pro"
  })
});
```

## 3. Chat Conversations (Streaming)

```javascript
const response = await fetch('http://localhost:3000/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [
      {
        role: "user",
        parts: [{ text: "Hello, I need help with JavaScript" }]
      },
      {
        role: "model", 
        parts: [{ text: "Hello! I'd be happy to help you with JavaScript. What specific topic or problem would you like assistance with?" }]
      },
      {
        role: "user",
        parts: [{ text: "How do I handle async/await properly?" }]
      }
    ],
    model: "gemini-2.5-flash",
    config: {
      temperature: 0.3,
      systemInstruction: "You are a helpful JavaScript tutor. Provide clear, practical examples."
    }
  })
});

// Handle streaming response...
```

## 4. Embeddings

```javascript
const response = await fetch('http://localhost:3000/api/ai/embeddings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [
      "What is machine learning?",
      "How does AI work?",
      "Explain neural networks"
    ],
    model: "gemini-embedding-exp-03-07",
    config: {
      taskType: "SEMANTIC_SIMILARITY"
    }
  })
});

const result = await response.json();
console.log(result.embeddings);
```

## 5. Function Calling

```javascript
const response = await fetch('http://localhost:3000/api/tools/function-call', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: "What's the weather like in Tokyo right now?",
    model: "gemini-2.5-flash",
    tools: [{
      functionDeclarations: [{
        name: 'get_weather',
        description: 'Get current weather for a city',
        parameters: {
          type: 'object',
          properties: {
            city: {
              type: 'string',
              description: 'City name'
            },
            units: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
              default: 'celsius'
            }
          },
          required: ['city']
        }
      }]
    }]
  })
});

// Handle streaming response with function calls...
```

## 6. Context Caching

### Create Cache
```javascript
const cacheResponse = await fetch('http://localhost:3000/api/cache', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: "gemini-2.5-pro",
    contents: longDocumentContent,
    systemInstruction: "You are an expert document analyzer.",
    ttl: "3600s" // 1 hour
  })
});

const cache = await cacheResponse.json();
const cacheId = cache.name;
```

### Use Cache for Generation
```javascript
const response = await fetch(`http://localhost:3000/api/cache/${cacheId}/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: "gemini-2.5-pro",
    contents: "Summarize the key points from this document",
    config: {
      stream: true // Still streaming even with cache
    }
  })
});

// Handle streaming response...
```

## 7. File Analysis

### Direct Analysis (No Storage)
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('prompt', 'Analyze this document and extract key insights');
formData.append('model', 'gemini-2.5-pro');

const response = await fetch('http://localhost:3000/api/files/analyze-local', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(result.text);
```

### Persistent File Analysis
```javascript
// File already uploaded, analyze it
const response = await fetch(`http://localhost:3000/api/files/${fileId}/analyze`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: "What are the main topics discussed in this document?",
    model: "gemini-2.5-pro",
    config: {
      temperature: 0.3,
      maxOutputTokens: 1500
    }
  })
});
```

## 8. Error Handling

```javascript
try {
  const response = await fetch('http://localhost:3000/api/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: "Hello",
      model: "invalid-model" // This will cause an error
    })
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('API Error:', error.error.message);
    return;
  }

  // Handle streaming response...
} catch (error) {
  console.error('Network Error:', error);
}
```

## 9. System Instructions and Advanced Configuration

```javascript
const response = await fetch('http://localhost:3000/api/ai/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: "Write a short story about a robot",
    model: "gemini-2.5-pro",
    config: {
      systemInstruction: "You are a creative writing assistant. Write engaging, family-friendly stories with vivid descriptions and relatable characters.",
      temperature: 0.9, // Higher creativity
      maxOutputTokens: 2048,
      topP: 0.95,
      topK: 50,
      thinkingConfig: {
        thinkingBudget: 1000 // Allow thinking for better quality
      }
    }
  })
});
```

## Request/Response Format

### Streaming Response Format
```
data: {"success":true,"provider":"google","model":"gemini-2.5-flash","text":"Hello"}

data: {"success":true,"provider":"google","model":"gemini-2.5-flash","text":" there!"}

data: {"success":true,"provider":"google","model":"gemini-2.5-flash","text":" How"}

data: [DONE]
```

### Error Response Format
```javascript
{
  "success": false,
  "error": {
    "message": "Model 'invalid-model' not supported by provider 'google'",
    "provider": "google"
  }
}
```

## Rate Limits

- **AI Generation**: 50 requests per 15 minutes
- **File Upload**: 20 uploads per hour  
- **General API**: 100 requests per 15 minutes

Rate limit headers are included in responses:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining` 
- `X-RateLimit-Reset` 