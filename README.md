# Apsara Backend

A comprehensive AI backend wrapper that provides unified access to multiple AI providers with REST API and Live API (WebSocket) support for real-time interactions.

## Features

### 🚀 Core Capabilities
- **Multi-Provider Support**: Currently supports Google Gemini, extensible for Claude, Grok, and others
- **REST API**: Streaming-only text generation and multimodal processing
- **Live API**: Real-time WebSocket streaming with native audio and video interactions
- **Multimodal Support**: Text, images, audio, video, and document processing
- **Context Caching**: Efficient token usage with explicit and implicit caching
- **Tools & Plugins**: Function calling (code execution and search as external plugins)
- **File Management**: Upload, analyze, and manage files across providers
- **Session Management**: Live session resumption and incremental content updates

### 🔧 Technical Features
- **Modular Architecture**: Easy to extend with new AI providers
- **Rate Limiting**: Configurable rate limits per endpoint
- **Session Management**: Live session handling with resumption support
- **Ephemeral Tokens**: Secure client-to-server authentication
- **Voice Activity Detection**: Real-time interruption handling
- **MongoDB Integration**: Persistent data storage
- **WebSocket Support**: Real-time bidirectional communication

## Project Structure

```
apsara-backend/
├── src/
│   ├── config/
│   │   └── database.js              # MongoDB connection
│   ├── middleware/
│   │   ├── errorHandler.js          # Error handling
│   │   └── rateLimiter.js           # Rate limiting
│   ├── providers/
│   │   ├── base/
│   │   │   └── BaseProvider.js      # Base provider interface
│   │   ├── google/
│   │   │   └── GoogleProvider.js    # Google Gemini implementation
│   │   └── ProviderManager.js       # Provider management
│   ├── routes/
│   │   ├── ai.js                    # AI generation endpoints
│   │   ├── cache.js                 # Context caching
│   │   ├── files.js                 # File management
│   │   ├── sessions.js              # Session management
│   │   ├── tools.js                 # Tools & function calling
│   │   └── users.js                 # User management (placeholder)
│   ├── services/
│   │   └── websocket/
│   │       ├── liveApiServer.js     # WebSocket Live API
│   │       └── SessionManager.js    # Session state management
│   └── server.js                    # Main server file
├── docs/                            # Documentation files
├── package.json                     # Dependencies
├── env.example                      # Environment variables template
└── README.md                        # This file
```

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB Atlas account
- Google Gemini API key

### Installation

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd apsara-backend
npm install
```

2. **Set up environment variables:**
```bash
cp env.example .env
# Edit .env with your configuration
```

3. **Configure environment variables:**
```bash
# Required
GOOGLE_GEMINI_API_KEY=your_gemini_api_key_here
DB_PASSWORD=shubhi21

# Optional (with defaults)
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb+srv://apsara:<db_password>@cluster0.lwdjlnp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
```

4. **Start the server:**
```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### REST API Base URL: `http://localhost:3000/api`

#### AI Generation (Streaming-Only)
- `POST /ai/generate` - Generate AI content (streaming response)
- `POST /ai/chat` - Multi-turn conversations (streaming response)
- `POST /ai/embeddings` - Generate embeddings
- `GET /ai/providers` - List available providers
- `GET /ai/models` - List available models

**✨ Thinking Support**: All generation endpoints support Gemini 2.5 thinking capabilities

#### File Management
- `POST /files/upload` - Upload files
- `GET /files` - List files
- `GET /files/:fileId` - Get file metadata
- `POST /files/:fileId/analyze` - Analyze file with AI
- `DELETE /files/:fileId` - Delete file

#### Context Caching
- `POST /cache` - Create cache
- `GET /cache` - List caches
- `GET /cache/:cacheId` - Get cache metadata
- `POST /cache/:cacheId/generate` - Generate with cached context

#### Tools & Plugins
- `POST /tools/function-call` - Execute function calling
- `POST /tools/combined` - Use multiple function calls
- `GET /tools/capabilities` - Get tool capabilities
- `POST /tools/validate` - Validate tool configurations
- *Note: Code execution and Google Search are now external plugins*

#### Sessions
- `POST /sessions/ephemeral-token` - Create ephemeral tokens
- `GET /sessions/models` - Get Live API models
- `GET /sessions/features` - Get Live API features

### WebSocket API

**Endpoint:** `ws://localhost:3000/live`

#### Message Types
- `create_session` - Start a live session (with optional resumption)
- `send_message` - Send text/file message (new structure)
- `send_realtime_input` - Send audio/video/image separately
- `send_incremental_update` - Load conversation context
- `send_tool_response` - Respond to tool calls
- `end_session` - End session

## Usage Examples

### REST API - Streaming Text Generation

```javascript
const response = await fetch('http://localhost:3000/api/ai/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: "Explain quantum computing",
    model: "gemini-2.5-flash", // or "gemini-2.5-pro"
    config: {
      temperature: 0.7,
      maxOutputTokens: 1024,
      // ✨ Thinking Configuration
      thinkingConfig: {
        includeThoughts: true,    // Enable thought summaries
        thinkingBudget: -1        // -1: dynamic, 0: disabled, or specific token count
      },
      // ✨ System Instructions
      systemInstruction: "You are a helpful physics tutor"
    }
  })
});

// Handle streaming response with thoughts
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
      if (data === '[DONE]') break;
      
      try {
        const parsed = JSON.parse(data);
        
        // Handle thoughts (reasoning process)
        if (parsed.thought && parsed.isThinking) {
          console.log('AI Thinking:', parsed.thought);
        }
        
        // Handle regular response text
        if (parsed.text) {
          console.log('Response:', parsed.text);
        }
      } catch (e) {
        // Handle parsing errors
      }
    }
  }
}
```

### 🧠 **Thinking Configuration**

Apsara backend supports Gemini 2.5's thinking capabilities for enhanced reasoning:

#### **Thinking Budget Settings**

| Model | Default | Range | Disable | Dynamic |
|-------|---------|-------|---------|---------|
| **gemini-2.5-pro** | Dynamic | 128-32,768 | ❌ Cannot disable | `thinkingBudget: -1` |
| **gemini-2.5-flash** | Dynamic | 0-24,576 | `thinkingBudget: 0` | `thinkingBudget: -1` |

#### **Configuration Examples**

```javascript
// Enable thinking with dynamic budget
{
  "thinkingConfig": {
    "includeThoughts": true,
    "thinkingBudget": -1
  }
}

// Set specific thinking budget
{
  "thinkingConfig": {
    "includeThoughts": true,
    "thinkingBudget": 1024
  }
}

// Disable thinking (Flash only)
{
  "thinkingConfig": {
    "includeThoughts": false,
    "thinkingBudget": 0
  }
}
```

#### **Streaming Response Format**

```javascript
// Thinking chunks
{
  "thought": "I need to break down quantum computing concepts...",
  "isThinking": true
}

// Regular response chunks
{
  "text": "Quantum computing is a revolutionary technology...",
  "isThinking": false
}
```

### REST API - File Analysis

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('prompt', 'Describe this image in detail');

const response = await fetch('http://localhost:3000/api/files/analyze-local', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(result.text);
```

### WebSocket Live API

```javascript
const ws = new WebSocket('ws://localhost:3000/live');

ws.onopen = () => {
  // Create a live session
  ws.send(JSON.stringify({
    type: 'create_session',
    data: {
      model: 'gemini-2.0-flash-live-001', // or native audio models
      config: {
        responseModalities: ['TEXT'],
        sessionResumption: {},
        contextWindowCompression: { slidingWindow: {} }
      }
    }
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
  
  if (message.type === 'session_created') {
    // Send a message with new structure
    ws.send(JSON.stringify({
      type: 'send_message',
      data: {
        sessionId: message.sessionId,
        text: 'Hello, how are you?',
        turnComplete: true
      }
    }));
  }
  
  // Handle session resumption updates
  if (message.type === 'session_resumption_update') {
    localStorage.setItem('sessionHandle', message.data.newHandle);
  }
};
```

### Function Calling

```javascript
const response = await fetch('http://localhost:3000/api/tools/function-call', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: "What's the weather like in New York?",
    tools: [{
      functionDeclarations: [{
        name: 'get_weather',
        description: 'Get weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' }
          }
        }
      }]
    }]
  })
});
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `MONGODB_URI` | MongoDB connection string | See env.example |
| `DB_PASSWORD` | Database password | shubhi21 |
| `GOOGLE_GEMINI_API_KEY` | Google Gemini API key | Required |
| `MAX_FILE_SIZE` | Maximum file upload size | 100MB |
| `RATE_LIMIT_MAX_REQUESTS` | Rate limit per window | 100 |
| `SESSION_TIMEOUT` | Live session timeout | 900000ms |

### Provider Configuration

Currently supports Google Gemini with the following models:

#### REST API Models (Streaming-Only)
- `gemini-2.5-flash` - Fast text generation
- `gemini-2.5-pro` - Advanced reasoning

#### Live API Models
**Half-Cascade Models (Production Ready):**
- `gemini-live-2.5-flash-preview` - Default live model
- `gemini-2.0-flash-live-001` - Alternative live model

**Native Audio Models (Advanced Features):**
- `gemini-2.5-flash-preview-native-audio-dialog` - Native audio with dialog
- `gemini-2.5-flash-exp-native-audio-thinking-dialog` - Native audio with thinking

#### Embedding Models
- `gemini-embedding-exp-03-07` - Advanced embeddings
- `text-embedding-004` - Standard embeddings

## Development

### Adding New Providers

1. Create a new provider class extending `BaseProvider`:

```javascript
// src/providers/claude/ClaudeProvider.js
import { BaseProvider } from '../base/BaseProvider.js';

export class ClaudeProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'claude';
  }
  
  async initialize() {
    // Initialize Claude API client
  }
  
  async generateContent(params) {
    // Implement Claude text generation
  }
  
  // Implement other required methods...
}
```

2. Register in ProviderManager:

```javascript
// src/providers/ProviderManager.js
import { ClaudeProvider } from './claude/ClaudeProvider.js';

// In initialize() method:
const claudeProvider = new ClaudeProvider();
await claudeProvider.initialize();
this.providers.set('claude', claudeProvider);
```

### Running Tests

```bash
npm test
```

### Linting

```bash
npm run lint
npm run lint:fix
```

## Production Deployment

### Prerequisites
- Node.js 18+ production environment
- MongoDB Atlas cluster
- SSL certificate (for HTTPS/WSS)
- Environment variables configured

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src ./src
EXPOSE 3000
CMD ["npm", "start"]
```

### Health Checks

- **HTTP**: `GET /health`
- **WebSocket**: `GET /api/sessions/health`

## Security Considerations

1. **API Keys**: Never expose API keys in client-side code
2. **Rate Limiting**: Configured per endpoint
3. **Ephemeral Tokens**: Use for client-to-server Live API connections
4. **File Validation**: Automatic file type and size validation
5. **CORS**: Configure origins appropriately for production

## Monitoring & Logging

- Request/response logging via Morgan
- Error tracking with structured error handling
- Rate limit monitoring
- Session analytics
- Provider usage statistics

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement changes with tests
4. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For questions and support, please refer to the documentation or create an issue in the repository.

---

## Testing

### Comprehensive Testing Script

Use the included testing script to verify all functionality:

```bash
# Run all tests
npm run test:integration
# OR
node test-apsara.js

# Test specific features
npm run test:rest         # REST API only
npm run test:live         # Live API only  
npm run test:files        # File management only
npm run test:cache        # Context caching only
npm run test:tools        # Function calling only
npm run test:sessions     # Session management only

# Get help
node test-apsara.js --help
```

The script tests:
- ✅ REST API streaming responses
- ✅ Live API WebSocket connections
- ✅ Session creation and management
- ✅ File upload and analysis
- ✅ Context caching
- ✅ Function calling
- ✅ Realtime input handling
- ✅ Session resumption
- ✅ Model validation

### Prerequisites for Testing
1. Server running (`npm run dev`)
2. Environment variables configured
3. Valid API keys set

## Real-World Use Cases & Monetization

### 💰 Business Applications

#### 1. **AI-Powered Customer Support Platform**
- **Revenue Model**: SaaS subscription ($50-500/month per business)
- **Features**: Live voice support, document analysis, multilingual support
- **Market**: Small to enterprise businesses
- **Implementation**: Use Live API for real-time voice, REST API for document processing

#### 2. **Educational Content Creation Platform**
- **Revenue Model**: Per-content pricing + subscriptions ($10-100/month)
- **Features**: Auto-generate courses, quizzes, explanations from documents
- **Market**: Educational institutions, content creators
- **Implementation**: File upload + analysis, context caching for efficiency

#### 3. **Real-Estate Virtual Assistant**
- **Revenue Model**: Commission-based (2-5% of deals) or monthly subscriptions
- **Features**: Property description generation, virtual tours, client Q&A
- **Market**: Real estate agents, property management companies
- **Implementation**: Image analysis for properties, live voice for client interaction

#### 4. **Medical Documentation Assistant**
- **Revenue Model**: Enterprise licensing ($1000-10000/month per clinic)
- **Features**: Transcribe consultations, generate reports, medical image analysis
- **Market**: Healthcare providers, medical practices
- **Implementation**: Live API for transcription, file analysis for medical images

#### 5. **Content Moderation Service**
- **Revenue Model**: API usage pricing ($0.01-0.10 per request)
- **Features**: Real-time content analysis, automated moderation, compliance checking
- **Market**: Social media platforms, online communities
- **Implementation**: REST API for batch processing, Live API for real-time moderation

#### 6. **Smart Meeting Assistant**
- **Revenue Model**: Freemium + Pro subscriptions ($15-50/month per user)
- **Features**: Live transcription, action item extraction, meeting summaries
- **Market**: Business professionals, remote teams
- **Implementation**: Live API for real-time transcription, function calling for calendar integration

#### 7. **Legal Document Analyzer**
- **Revenue Model**: Per-document pricing ($5-50 per document) + subscriptions
- **Features**: Contract analysis, compliance checking, legal research
- **Market**: Law firms, legal departments, small businesses
- **Implementation**: File upload for document analysis, context caching for legal precedents

#### 8. **E-commerce Product Assistant**
- **Revenue Model**: Revenue sharing (1-3% of sales) or monthly subscriptions
- **Features**: Product descriptions, customer support, recommendation engine
- **Market**: E-commerce businesses, online retailers
- **Implementation**: Image analysis for products, live chat for customer support

### 🚀 Implementation Strategies

#### Rapid Prototyping (1-2 weeks)
1. Choose a specific use case
2. Set up basic frontend (React/Vue)
3. Integrate 2-3 core Apsara endpoints
4. Deploy MVP and gather user feedback

#### Scaling Strategy
1. **Start Small**: Focus on one specific industry/use case
2. **Prove Value**: Demonstrate clear ROI for early customers
3. **Iterate Fast**: Use the modular architecture to add features quickly
4. **Expand**: Add more AI providers and advanced features

#### Technical Advantages
- **Multi-modal Support**: Handle text, voice, images, documents
- **Real-time Capabilities**: Live interaction for better user experience
- **Scalable Architecture**: Easy to add new features and providers
- **Cost Optimization**: Context caching reduces API costs significantly

### 📊 Market Positioning

| Use Case | Market Size | Competition Level | Revenue Potential |
|----------|-------------|-------------------|-------------------|
| Customer Support | $25B+ | High | $10K-100K/month |
| Education | $8B+ | Medium | $5K-50K/month |
| Healthcare | $15B+ | Low (regulatory) | $20K-200K/month |
| Legal Tech | $5B+ | Medium | $15K-150K/month |
| E-commerce | $50B+ | High | $5K-500K/month |

**Apsara Backend** - Making AI accessible through a unified, extensible interface. 