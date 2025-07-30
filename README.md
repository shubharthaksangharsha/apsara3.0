# 🚀 Apsara AI Backend

Apsara is a comprehensive AI backend built with Node.js/Express that serves as a multimodal AI wrapper with a focus on REST API providers. It provides a unified interface for multiple AI providers (currently Google Gemini) with advanced features like thinking capabilities, plugin system, and real-time conversation management.

## 🎯 Key Features

- **🤖 Multi-Provider AI Wrapper**: Unified interface for different AI providers
- **🧠 Thinking Integration**: Full support for Gemini's thinking capabilities
- **🔧 Plugin System**: Extensible plugin architecture for custom functionality
- **💾 Database Integration**: MongoDB with comprehensive conversation and message storage
- **📝 Conversation History**: Automatic conversation context management with message sequencing
- **⚡ Real-time Streaming**: Server-sent events for streaming responses
- **📁 File Processing**: Multimodal support for images, audio, video, and documents
- **🔐 Authentication**: JWT-based authentication with email verification
- **📊 Rate Limiting**: IP-based rate limiting with different tiers
- **🛠️ Management Tools**: CLI tools for database management and testing

## 🏗️ Architecture

### Provider System
Apsara uses a provider pattern that allows easy integration of multiple AI services:
- **Current**: Google Gemini (2.5 Flash, 2.5 Pro, 2.5 Flash-Lite)
- **Future**: Claude, Grok, OpenAI, and other providers

### Database Schema
- **Users**: Authentication, preferences, usage tracking
- **Conversations**: Multi-turn conversation management with flexible model support
- **Messages**: Individual messages with sequential numbering, metadata, thinking, and token usage
- **Files**: File storage and analysis tracking

### Plugin Architecture
- **Provider-based**: Plugins organized by AI provider (e.g., `/api/plugins/google/calculator/send`)
- **Extensible**: Easy to add new plugins and providers
- **AI Integration**: Optional AI model responses to plugin results
- **Database Storage**: All plugin executions stored with message tracking

## 🚦 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB Atlas account
- Google Gemini API key

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd apsara-backend

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Configure your environment variables
# Edit .env with your credentials
```

### Environment Variables

```bash
# Server Configuration
PORT=5000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000

# Database
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/apsara
DB_PASSWORD=your_database_password

# Google Gemini API
GOOGLE_GEMINI_API_KEY=your_gemini_api_key

# JWT Configuration
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d

# Email Configuration (Gmail SMTP)
EMAIL_USERNAME=your_email@gmail.com
EMAIL_PASSWORD=your_app_password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW=15

# File Upload
MAX_FILE_SIZE=104857600
UPLOAD_PATH=./uploads
```

### Running the Server

```bash
# Development mode
npm run dev

# Production mode
npm start

# Management CLI
npm run manage
```

## 📚 API Documentation

### Base URL
```
http://localhost:5000/api
```

### 🔐 Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/users/register` | Register new user |
| POST | `/users/login` | Login user |
| POST | `/users/guest-login` | Guest login |
| POST | `/users/verify-email` | Verify email with OTP |
| GET | `/users/profile` | Get user profile |
| PUT | `/users/profile` | Update user profile |

### 🤖 AI Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/ai/generate` | Generate AI content with conversation storage |
| POST | `/ai/edit-message` | Edit user message and regenerate AI response |
| POST | `/ai/embeddings` | Generate text embeddings |
| GET | `/ai/providers` | List available providers |
| GET | `/ai/models` | List available models |

#### AI Generation with Conversation History

**Required Parameters**: `userId`, `conversationId`, `contents`

```bash
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "conversationId": "conv456", 
    "contents": "Explain quantum computing",
    "model": "gemini-2.5-flash",
    "config": {
      "temperature": 0.7,
      "thinkingConfig": {
        "thinkingBudget": 1024,
        "includeThoughts": true
      },
      "conversationHistory": {
        "include": true,
        "maxMessages": 20,
        "includeThoughts": false
      }
    }
  }'
```

**Response Structure**:
```json
{
  "success": true,
  "provider": "google",
  "model": "gemini-2.5-flash",
  "conversationId": "conv456",
  "userMessage": {
    "messageId": "msg789",
    "messageSequence": 3,
    "content": "Explain quantum computing"
  },
  "modelMessage": {
    "messageId": "msg790",
    "messageSequence": 4,
    "content": "Quantum computing is..."
  },
  "text": "Quantum computing is...",
  "thoughts": "The user is asking about quantum computing...",
  "conversationStats": {
    "totalMessages": 4,
    "totalTokens": 1250,
    "messageSequence": 4
  },
  "usageMetadata": {
    "promptTokenCount": 15,
    "candidatesTokenCount": 45,
    "totalTokenCount": 60
  }
}
```

#### Message Editing

**Edit a user message and regenerate subsequent AI responses:**

```bash
curl -X POST http://localhost:5000/api/ai/edit-message \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "conversationId": "conv456",
    "messageId": "msg789",
    "newContent": "What is quantum computing and how does it work?",
    "model": "gemini-2.5-pro",
    "config": {
      "temperature": 0.8,
      "maxOutputTokens": 4096,
      "thinkingConfig": {
        "thinkingBudget": 2048,
        "includeThoughts": true
      }
    }
  }'
```

**Edit Message Response Structure:**
```json
{
  "success": true,
  "provider": "google",
  "model": "gemini-2.5-pro",
  "conversationId": "conv456",
  "editedMessage": {
    "messageId": "msg789",
    "messageSequence": 3,
    "content": "What is quantum computing and how does it work?"
  },
  "newResponse": {
    "messageId": "msg800",
    "messageSequence": 4,
    "content": "Quantum computing is a revolutionary computing paradigm..."
  },
  "deletedCount": 2,
  "text": "Quantum computing is a revolutionary computing paradigm...",
  "thoughts": "The user is asking for a comprehensive explanation...",
  "usageMetadata": {
    "promptTokenCount": 25,
    "candidatesTokenCount": 180,
    "totalTokenCount": 205,
    "thoughtsTokenCount": 45
  },
  "modelMetadata": {
    "provider": "google",
    "model": "gemini-2.5-pro",
    "apiVersion": "2.5",
    "temperature": 0.8,
    "maxOutputTokens": 4096,
    "systemInstruction": "You are a helpful assistant",
    "thinkingConfig": {
      "thinkingBudget": 2048,
      "includeThoughts": true
    }
  }
}
```

### 🔧 Plugin System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/plugins/list_plugins` | List all available plugins |
| GET | `/plugins/:provider` | List plugins for provider |
| POST | `/plugins/:provider/:plugin/send` | Execute plugin |
| GET | `/plugins/:provider/:plugin/response` | Get plugin response |
| POST | `/plugins/function-call` | Execute plugins via function calling |

#### Available Plugins

**Calculator Plugin**
```bash
curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "conversationId": "conv456",
    "parameters": {
      "operation": "add",
      "number1": 10,
      "number2": 5
    },
    "sendToModel": true,
    "modelConfig": {
      "model": "gemini-2.5-flash",
      "provider": "google",
      "includeConversationHistory": true
    }
  }'
```

**Echo Plugin**
```bash
curl -X POST http://localhost:5000/api/plugins/google/echo/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "conversationId": "conv456",
    "parameters": {
      "message": "Hello, World!"
    },
    "sendToModel": false
  }'
```

**Plugin Response Structure**:
```json
{
  "success": true,
  "plugin": "calculator",
  "provider": "google",
  "conversationId": "conv456",
  "messageId": "msg791",
  "messageSequence": 5,
  "result": {
    "success": true,
    "result": 15,
    "operation": "add",
    "operands": { "number1": 10, "number2": 5 },
    "message": "10 add 5 = 15"
  },
  "responseId": "resp123",
  "sendToModel": true,
  "aiResponse": {
    "messageId": "msg792",
    "messageSequence": 6,
    "content": "The calculation shows that 10 + 5 equals 15...",
    "thoughts": "This is a simple addition problem...",
    "tokenUsage": { "totalTokenCount": 25 }
  }
}
```

### 💬 Conversations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/conversations` | Create conversation |
| GET | `/conversations/:userId` | Get user conversations |
| GET | `/conversations/:conversationId/messages` | Get conversation messages |
| PUT | `/conversations/:conversationId` | Update conversation |
| DELETE | `/conversations/:conversationId` | Delete conversation |

### 📁 File Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/files/upload` | Upload files to AI provider |
| GET | `/files` | List uploaded files |
| POST | `/files/:fileId/analyze` | Analyze uploaded file |
| POST | `/files/analyze-local` | Analyze local file |
| GET | `/files/supported-types` | Get supported file types |

## 🧠 Thinking Integration

Apsara fully supports Google Gemini's thinking capabilities:

### Thinking Configuration

```javascript
{
  thinkingConfig: {
    thinkingBudget: -1, // -1 = Dynamic, 0 = Off, positive = token count
    includeThoughts: true // Include thought summaries in response
  }
}
```

### Model-Specific Budgets

- **Gemini 2.5 Pro**: 128-32768 tokens (cannot disable)
- **Gemini 2.5 Flash**: 0-24576 tokens (can disable)
- **Gemini 2.5 Flash-Lite**: 512-24576 tokens or 0

### Response Structure

```javascript
{
  success: true,
  provider: "google",
  model: "gemini-2.5-flash",
  text: "AI response text",
  thoughts: "Thought summary", // When includeThoughts: true
  hasThoughtSignatures: true/false,
  usageMetadata: {
    promptTokenCount: 10,
    candidatesTokenCount: 50,
    totalTokenCount: 60,
    thoughtsTokenCount: 20
  }
}
```

## 🛠️ Management CLI

The management CLI provides easy database interaction:

```bash
npm run manage
```

### CLI Features

1. **Create Conversation** - Create new conversations (no model required, system message only asked once)
2. **List Conversations** - View all conversations with selection interface
3. **Choose Conversation** - Select conversation from list (no manual ID entry)
4. **View Messages** - Display conversation messages with sequencing
5. **Send Message to AI** - Advanced message sending with full configuration options
6. **Edit Message** - Edit user messages and regenerate AI responses
7. **Call Plugin** - Execute plugins with comprehensive AI integration
8. **Create User** - Add new users
9. **List Users** - View all users
10. **Choose User** - Select user from list (no manual ID entry)
11. **Delete User** - Delete specific user with confirmation
12. **Delete All Users** - Delete all users with double confirmation
13. **Database Statistics** - View comprehensive usage statistics
14. **Exit** - Close the CLI

### Enhanced CLI Features

**Startup User Selection**:
- Automatic user list on startup
- Shows recent conversations for selected user
- Skip option for no user selection
- Graceful handling when no users exist

**Advanced Message Configuration**:
- Model selection (gemini-2.5-flash, gemini-2.5-pro, gemini-2.5-flash-lite)
- Temperature control (0.0-2.0)
- Max output tokens configuration
- Conversation history settings (include/exclude, max messages)
- Advanced thinking configuration:
  - Dynamic thinking (-1)
  - Disabled thinking (0)
  - Custom token budget (1-32768)
  - Include/exclude thoughts in response

**Message Editing**:
- Select from list of user messages
- Edit message content
- Automatic deletion of subsequent messages
- Full AI configuration for regenerated response
- Complete metadata display

**Enhanced Plugin Execution**:
- Calculator and Echo plugins
- Advanced AI model configuration
- Provider selection (google, future: claude, grok)
- Temperature and token control
- Thinking configuration
- Conversation history integration
- Comprehensive response metadata

**System Message Persistence**:
- System messages set once per conversation
- Consistent throughout conversation lifetime
- No re-prompting for existing conversations
- New conversations require system message setup

## 🔗 Provider API Differences & Use Cases

### AI Generation (`/api/ai/generate`)
**Purpose**: Direct AI text generation with conversation management
**Use Cases**:
- Chat applications
- Content generation
- Q&A systems
- Educational assistants

**Key Features**:
- Conversation history integration
- Thinking capabilities
- Token usage tracking
- Database persistence

### Plugin System (`/api/plugins/*`)
**Purpose**: Structured function/tool calling with optional AI integration
**Use Cases**:
- Calculators and utilities
- External API integrations
- Data processing tools
- Custom business logic

**Key Features**:
- Provider-specific organization
- Optional AI model responses
- Function calling pattern
- Extensible architecture

### Provider Management
**Current Implementation**: Google Gemini
**Future Providers**: Claude, Grok, OpenAI

**Provider Benefits**:
- **Unified Interface**: Same API across providers
- **Provider-Specific Features**: Leverage unique capabilities
- **Fallback Support**: Switch providers for reliability
- **Cost Optimization**: Use different providers for different tasks

## 📊 Rate Limiting

Different endpoints have different rate limits:

- **General API**: 100 requests/15 minutes
- **AI Endpoints**: 50 requests/15 minutes
- **Plugin Execution**: 30 executions/15 minutes
- **File Uploads**: 20 uploads/hour
- **Live API**: 10 connections/hour
- **Authentication**: 10 attempts/15 minutes

## 🔗 Testing Endpoints

### Health Check
```bash
curl http://localhost:5000/health
```

### User Registration
```bash
curl -X POST http://localhost:5000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Test User",
    "email": "test@example.com",
    "password": "password123",
    "acceptTerms": true
  }'
```

### Create Conversation
```bash
curl -X POST http://localhost:5000/api/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_id_here",
    "title": "Test Conversation",
    "type": "rest",
    "config": {
      "rest": {
        "systemInstruction": "You are a helpful assistant",
        "temperature": 0.7
      }
    }
  }'
```

### AI Generation with Conversation
```bash
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_id_here",
    "conversationId": "conv_id_here",
    "contents": "What is machine learning?",
    "model": "gemini-2.5-flash",
    "config": {
      "temperature": 0.7,
      "thinkingConfig": {
        "thinkingBudget": -1,
        "includeThoughts": true
      },
      "conversationHistory": {
        "include": true,
        "maxMessages": 20
      }
    }
  }'
```

### Plugin Execution
```bash
# List all plugins
curl http://localhost:5000/api/plugins/list_plugins

# Execute calculator plugin with AI analysis
curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_id_here",
    "conversationId": "conv_id_here",
    "parameters": {
      "operation": "multiply",
      "number1": 7,
      "number2": 8
    },
    "sendToModel": true,
    "modelConfig": {
      "model": "gemini-2.5-flash",
      "provider": "google",
      "includeConversationHistory": true,
      "maxHistoryMessages": 10
    }
  }'
```

### Function Calling
```bash
curl -X POST http://localhost:5000/api/plugins/function-call \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_id_here",
    "conversationId": "conv_id_here",
    "provider": "google",
    "functions": [
      {
        "name": "calculator",
        "parameters": {
          "operation": "add",
          "number1": 15,
          "number2": 25
        }
      },
      {
        "name": "echo",
        "parameters": {
          "message": "Function calling test"
        }
      }
    ],
    "modelConfig": {
      "model": "gemini-2.5-flash",
      "temperature": 0.7,
      "includeConversationHistory": true,
      "thinkingConfig": {
        "thinkingBudget": -1,
        "includeThoughts": true
      }
    }
  }'
```

### Message Editing
```bash
curl -X POST http://localhost:5000/api/ai/edit-message \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_id_here",
    "conversationId": "conv_id_here",
    "messageId": "message_id_to_edit",
    "newContent": "This is the edited message content",
    "model": "gemini-2.5-flash",
    "config": {
      "temperature": 0.7,
      "maxOutputTokens": 2048,
      "thinkingConfig": {
        "thinkingBudget": -1,
        "includeThoughts": true
      }
    }
  }'
```

## 🏢 Project Structure

```
apsara-backend/
├── src/
│   ├── config/
│   │   └── database.js          # Database configuration
│   ├── middleware/
│   │   ├── errorHandler.js      # Error handling middleware
│   │   └── rateLimiter.js       # Rate limiting middleware
│   ├── models/
│   │   ├── User.js              # User model
│   │   ├── Conversation.js      # Conversation model (no fixed model)
│   │   ├── Message.js           # Message model with sequencing
│   │   └── File.js              # File model
│   ├── providers/
│   │   ├── base/
│   │   │   └── BaseProvider.js  # Abstract base provider
│   │   ├── google/
│   │   │   └── GoogleProvider.js # Google Gemini implementation
│   │   └── ProviderManager.js   # Provider management
│   ├── routes/
│   │   ├── ai.js                # AI generation with conversation history
│   │   ├── tools.js             # Plugin system with conversation support
│   │   ├── users.js             # User management
│   │   ├── conversations.js     # Conversation management
│   │   ├── files.js             # File management
│   │   ├── sessions.js          # Session management
│   │   └── google-auth.js       # Google authentication
│   ├── services/
│   │   ├── emailService.js      # Email service
│   │   ├── database/
│   │   │   └── ConversationService.js
│   │   └── websocket/
│   │       ├── liveApiServer.js # WebSocket Live API
│   │       └── SessionManager.js
│   └── server.js                # Main server file
├── scripts/
│   └── manage-conversations.js  # Enhanced CLI management tool
├── uploads/                     # File upload directory
├── package.json
├── .env.example
└── README.md
```

## 🔮 Future Enhancements

- **Multi-Provider Support**: Claude, Grok, OpenAI integration
- **Advanced Plugins**: Code execution, web search, custom integrations
- **Live API**: Real-time audio/video processing
- **Plugin Marketplace**: Community-driven plugin ecosystem
- **Conversation Templates**: Pre-configured conversation types
- **Caching**: Redis integration for improved performance
- **Analytics**: Advanced usage analytics and monitoring
- **Docker**: Containerization for easy deployment

## 📝 Key Changes Made

### Database Schema Updates
- ✅ **Removed model requirement** from conversations (flexible model per message)
- ✅ **Added messageSequence** for incremental message numbering
- ✅ **Enhanced conversation history** support
- ✅ **Message editing history** tracking

### API Enhancements
- ✅ **Required userId and conversationId** for all AI and plugin requests
- ✅ **Conversation history integration** with configurable options
- ✅ **Plugin system redesign** with provider organization
- ✅ **AI integration for plugins** with optional model responses
- ✅ **Message editing endpoint** with conversation branching
- ✅ **Enhanced response metadata** with comprehensive model information
- ✅ **Advanced configuration options** (temperature, tokens, thinking)

### User Experience Improvements
- ✅ **Selection-based UI** instead of manual ID entry
- ✅ **Startup user selection** with conversation preview
- ✅ **Enhanced configuration options** for all AI interactions
- ✅ **System message persistence** per conversation
- ✅ **User management** with deletion capabilities

### Management Tools
- ✅ **Enhanced CLI** with 14 comprehensive options
- ✅ **Message editing** from CLI interface
- ✅ **Advanced plugin configuration** with thinking support
- ✅ **Real-time testing** capabilities
- ✅ **Database inspection** and statistics
- ✅ **User management** with safety confirmations

### Provider Architecture
- ✅ **Provider-agnostic design** for easy multi-provider support
- ✅ **Unified response format** across providers
- ✅ **Extensible plugin system** per provider
- ✅ **Enhanced metadata** in all responses
- ✅ **Thinking integration** across all endpoints

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Google Gemini API for advanced AI capabilities
- MongoDB for robust database solutions
- Express.js for the web framework
- All contributors and the open-source community

---

**Built with ❤️ by the Apsara Team** 