# Apsara AI Backend

A production-ready AI conversation platform with multi-provider support, advanced rate limiting, comprehensive authentication, and powerful plugin system.

## 🌟 Key Features

### AI & Provider Integration
- ✅ **Multi-Provider Architecture** with Google Gemini (extensible for Claude, GPT, etc.)
- ✅ **Advanced Thinking Models** with Gemini 2.5 series support
- ✅ **Flexible Model Selection** per conversation and message
- ✅ **Automatic Conversation History** included in all AI interactions
- ✅ **Message Editing & Regeneration** with conversation branching
- ✅ **Enhanced Response Metadata** (tokens, timing, model info, thoughts)

### Authentication & User Management
- ✅ **Multiple Authentication Methods**:
  - Traditional registration with OTP verification
  - **Google OAuth integration** with account linking
  - **Guest login** with 5-message trial access
  - **Secure password reset** with two-step OTP verification
- ✅ **Role-based Access Control** (user, admin, guest)
- ✅ **Session Management** with JWT tokens and logout functionality

### Rate Limiting & Usage Control
- ✅ **Intelligent Rate Limiting System**:
  - **Guest**: 5 total messages (gemini-2.5-flash only)
  - **Free**: 20/day gemini-2.5-flash, 5/day gemini-2.5-pro, 30/day gemini-2.5-flash-lite
  - **Premium**: 100/day flash, 50/day pro, 200/day lite
  - **Enterprise**: Unlimited access
- ✅ **Usage Tracking & Analytics** with detailed statistics
- ✅ **Automatic Daily Reset** at midnight UTC
- ✅ **Real-time Usage Monitoring** with remaining limits in responses

### Plugin System
- ✅ **Provider-based Plugin Architecture** (`/api/plugins/{provider}/{plugin}/send`)
- ✅ **Synchronous & Asynchronous Execution** with `runAsync` parameter
- ✅ **AI Integration** with `sendToModel` for intelligent analysis
- ✅ **Built-in Plugins**: Calculator and Echo tools
- ✅ **Database Integration** for full conversation persistence

### Management Tools
- ✅ **Enhanced CLI** with 19 comprehensive options
- ✅ **User-specific Analytics** with password verification for security
- ✅ **Conversation Management** with bulk and selective deletion
- ✅ **Message editing** from CLI interface
- ✅ **Simplified plugin execution** with async support
- ✅ **Database Statistics** and monitoring tools

### Data Management
- ✅ **Conversation Persistence** with message sequencing
- ✅ **Incremental Message IDs** for ordered history retrieval
- ✅ **Comprehensive Metadata** storage (timing, tokens, config)
- ✅ **Usage History Tracking** with reset logs
- ✅ **Guest Session Management** with temporary accounts

## 🚀 Latest Performance & Workflow Improvements
- ✅ **Fixed Password Reset Flow** with proper OTP verification sequence
- ✅ **Enhanced async plugin support** with full database integration and AI responses
- ✅ **Automatic conversation context** in all AI interactions
- ✅ **Multiple authentication methods** with Google OAuth and guest access
- ✅ **Comprehensive rate limiting** with subscription-based tiers
- ✅ **Removed response endpoint** (streamlined plugin architecture)
- ✅ **User-specific analytics** with secure access control
- ✅ **Enhanced CLI management** with logout and advanced features

## 📊 API Endpoints

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/users/register` | Register with OTP verification |
| POST | `/users/verify-email` | Verify email with OTP |
| POST | `/users/login` | Traditional email/password login |
| POST | `/users/google-auth` | Google OAuth authentication |
| POST | `/users/guest-login` | Create guest session (5 messages) |
| POST | `/users/forgot-password` | Request password reset OTP |
| POST | `/users/verify-reset-otp` | Verify password reset OTP |
| POST | `/users/reset-password` | Set new password after OTP verification |

### AI Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/ai/generate` | Generate AI response (auto includes history) |
| POST | `/ai/edit-message` | Edit message and regenerate response |
| POST | `/ai/embeddings` | Generate text embeddings |

### Plugin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/plugins/list_plugins` | List all available plugins |
| GET | `/plugins/:provider` | List plugins for provider |
| POST | `/plugins/:provider/:plugin/send` | Execute plugin (sync/async) |

### Conversation Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/conversations` | Create conversation |
| GET | `/conversations` | List user conversations |
| GET | `/conversations/:id` | Get conversation details |
| GET | `/conversations/:id/messages` | Get conversation messages |
| PUT | `/conversations/:id` | Update conversation |
| DELETE | `/conversations/:id` | Delete conversation |

## 📖 Usage Examples

### Quick Start with Guest Access

```bash
# 1. Start guest session (no registration required)
curl -X POST http://localhost:5000/api/users/guest-login \
  -H "Content-Type: application/json" \
  -d '{}'

# 2. Create conversation
curl -X POST http://localhost:5000/api/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "guest_user_id",
    "title": "Quick Test",
    "systemInstruction": "You are a helpful assistant."
  }'

# 3. Send message (auto-includes history, rate limited to 5 total)
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "guest_user_id",
    "conversationId": "guest_conv_123",
    "content": "Hello! Explain AI in simple terms.",
    "model": "gemini-2.5-flash"
  }'
```

### Traditional Registration Flow

```bash
# 1. Register user
curl -X POST http://localhost:5000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "John Doe",
    "email": "john@example.com", 
    "password": "securepass123",
    "acceptTerms": true
  }'

# 2. Verify email with OTP
curl -X POST http://localhost:5000/api/users/verify-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "otp": "123456"
  }'

# 3. Login
curl -X POST http://localhost:5000/api/users/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "securepass123"
  }'
```

### Google OAuth Authentication

```bash
curl -X POST http://localhost:5000/api/users/google-auth \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "google_id_token_here",
    "email": "user@gmail.com",
    "name": "Google User"
  }'
```

### AI Generation with Thinking

```bash
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "conversationId": "conv_456", 
    "content": "Explain quantum computing",
    "model": "gemini-2.5-pro",
    "config": {
      "temperature": 0.7,
      "maxOutputTokens": 2048,
      "thinkingConfig": {
        "includeThoughts": true,
        "thinkingBudget": 2000
      }
    }
  }'
```

### Plugin Usage (Calculator)

```bash
# Synchronous execution with AI analysis
curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "conversationId": "conv_456",
    "parameters": {
      "number1": 15,
      "number2": 7,
      "operation": "multiply"
    },
    "sendToModel": true,
    "runAsync": false
  }'

# Asynchronous execution
curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123", 
    "conversationId": "conv_456",
    "parameters": {
      "number1": 100,
      "number2": 25,
      "operation": "divide"
    },
    "sendToModel": true,
    "runAsync": true
  }'
```

### Message Editing

```bash
curl -X POST http://localhost:5000/api/ai/edit-message \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "conversationId": "conv_456", 
    "messageId": "msg_789",
    "newContent": "Explain machine learning instead",
    "model": "gemini-2.5-flash",
    "config": {
      "temperature": 0.8,
      "maxOutputTokens": 1024,
      "thinkingConfig": {
        "includeThoughts": true,
        "thinkingBudget": 1000
      }
    }
  }'
```

## 📚 Comprehensive Documentation

Explore detailed usage examples and guides:

- **[Basic Usage](examples/01-basic-usage.md)** - Get started with core functionality
- **[Plugin Usage](examples/02-plugin-usage.md)** - Master the plugin system  
- **[Rate Limiting](examples/03-rate-limiting.md)** - Understand usage limits and plans
- **[Authentication](examples/04-authentication.md)** - All authentication methods
- **[CLI Usage](examples/05-cli-usage.md)** - Management tool guide

## 🔧 Management CLI (19 Options)

Start the interactive management tool:

```bash
npm run manage
```

### CLI Features:

1. **Create a new conversation** - Set up conversations with custom system instructions
2. **List all conversations** - View conversations across all users
3. **Choose a conversation** - Select active conversation for operations
4. **Send message to AI** - Test AI generation with full configuration
5. **List messages in conversation** - View conversation history
6. **Edit a message** - Modify previous messages and regenerate responses
7. **Call a plugin** - Test plugin functionality (sync/async)
8. **Create a user** - Add users to the database
9. **List all users** - View all registered users
10. **Choose/switch user** - Select active user for operations
11. **View schema and database info** - Database structure overview
12. **Delete user by email/ID** - Remove specific users
13. **Delete all conversations** - Clear all conversation data
14. **Delete specific conversation** - Remove individual conversations
15. **Full user registration** - Complete registration system with OTP verification
    - Register new user (with OTP)
    - Login existing user
    - **Login with Google OAuth**
    - **Guest login (5 messages limit)**
    - Forgot password (OTP reset)
16. **Logout current user** - Clear current session
17. **Database statistics** - Comprehensive usage analytics
18. **User-specific statistics** - Personal analytics (password protected)
19. **Exit** - Close the CLI

### Enhanced CLI Features

**Complete Registration System**:
- **Full OTP-based registration** with email verification
- **User login** with automatic profile loading and duplicate login prevention
- **Google OAuth integration** with account creation and linking
- **Guest login** with session management and usage tracking
- **Password reset** with proper OTP verification flow (verify first, then set password)
- **User logout** functionality with session management

**Advanced User Management**:
- **User-specific statistics** with password verification for security
- **Personal analytics** including conversation history, token usage, model preferences
- **Most active conversations** and message distribution analysis
- **Secure access** requiring current user authentication

**System Message Persistence**:
- System messages are persistent per conversation
- Cannot be changed mid-conversation (maintain consistency)
- New conversations can have different system instructions

**Enhanced Plugin System**:
- **Asynchronous plugin execution** with background processing
- **AI integration** for plugin result analysis
- **Database persistence** for all plugin interactions
- **Simplified configuration** with smart defaults

## 🎯 Rate Limiting System

### Subscription Tiers

| Plan | gemini-2.5-flash | gemini-2.5-pro | gemini-2.5-flash-lite | Features |
|------|------------------|------------------|------------------------|----------|
| **Guest** | 5 total messages | ❌ No access | ❌ No access | 24h session, trial access |
| **Free** | 20/day | 5/day | 30/day | Full features, daily reset |
| **Premium** | 100/day | 50/day | 200/day | Priority support, analytics |
| **Enterprise** | ♾️ Unlimited | ♾️ Unlimited | ♾️ Unlimited | Custom SLA, dedicated support |

### Rate Limit Response Example

```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "details": "Daily limit exceeded for gemini-2.5-flash. Used 20/20 messages today.",
  "usageInfo": {
    "subscriptionPlan": "free",
    "dailyUsage": {
      "date": "2024-01-15",
      "gemini-2.5-flash": { "count": 20, "limit": 20 },
      "gemini-2.5-pro": { "count": 3, "limit": 5 }
    },
    "totalUsage": {
      "totalMessages": 245,
      "totalTokens": 67890
    }
  }
}
```

## 🔐 Security & Authentication

### JWT Token Management
- Secure token-based authentication
- Configurable expiration times
- Role-based access control
- Guest session management

### Password Security
- Minimum 6 characters required
- Bcrypt hashing with salt
- Account lockout after failed attempts
- Secure password reset with OTP

### Google OAuth Integration
- Secure ID token verification
- Account linking capabilities
- Profile picture integration
- Email pre-verification

## 🗂️ Database Schema

### Users Collection
```javascript
{
  fullName: String,
  email: String (unique),
  password: String (hashed),
  role: String (user/admin/guest),
  subscriptionPlan: String (guest/free/premium/enterprise),
  authProvider: String (local/google),
  googleId: String,
  isGuest: Boolean,
  guestSessionId: String,
  isEmailVerified: Boolean,
  // ... additional fields
}
```

### UserUsage Collection (New)
```javascript
{
  userId: ObjectId,
  subscriptionPlan: String,
  dailyUsage: {
    date: Date,
    'gemini-2.5-flash': { count: Number, limit: Number },
    'gemini-2.5-pro': { count: Number, limit: Number },
    'gemini-2.5-flash-lite': { count: Number, limit: Number }
  },
  guestLimits: {
    totalMessagesLimit: Number,
    totalMessagesUsed: Number
  },
  totalUsage: {
    totalMessages: Number,
    totalTokens: Number,
    totalConversations: Number
  },
  // ... additional tracking fields
}
```

### Conversations Collection
```javascript
{
  conversationId: String (unique),
  userId: String,
  title: String,
  config: {
    rest: {
      systemInstruction: String,
      // Removed model field for flexibility
    }
  },
  stats: {
    messageSequence: Number, // Auto-incremented per conversation
    totalMessages: Number,
    totalTokens: Number
  },
  // ... additional fields
}
```

### Messages Collection  
```javascript
{
  messageId: String (unique),
  conversationId: String,
  userId: String,
  messageSequence: Number, // Ordered within conversation
  role: String (user/model/plugin),
  content: {
    text: String,
    thoughts: String // For AI thinking responses
  },
  config: Object,
  metadata: {
    timing: Object,
    tokens: Object,
    provider: Object
  },
  isEdited: Boolean,
  editHistory: Array,
  // ... additional fields
}
```

## 🚀 Installation & Setup

### Prerequisites
- Node.js 18+ 
- MongoDB 5.0+
- Email service credentials (for OTP)
- Google OAuth credentials (optional)

### Quick Start

```bash
# Clone repository
git clone https://github.com/your-org/apsara-backend.git
cd apsara-backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Start development server
npm run dev

# Run management CLI
npm run manage
```

### Environment Variables

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/apsara

# JWT Configuration  
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# Google Gemini API
GOOGLE_AI_API_KEY=your-gemini-api-key

# Email Service (for OTP)
EMAIL_SERVICE_API_KEY=your-email-api-key
EMAIL_FROM=noreply@yourapp.com

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

## 🔧 Development

### Available Scripts
```bash
npm run dev          # Start development server with hot reload
npm run start        # Start production server
npm run manage       # Launch management CLI
npm test             # Run test suite
npm run test:plugins # Test plugin functionality
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
```

### Testing

```bash
# Test basic functionality
npm test

# Test specific features
npm run test:auth
npm run test:rate-limiting
npm run test:plugins

# Integration testing via CLI
npm run manage
```

## 📈 Monitoring & Analytics

### Database Statistics
- User registration trends
- Subscription plan distribution
- Token usage patterns
- Model popularity metrics
- Error rate monitoring

### User Analytics
- Daily/monthly active users
- Conversation engagement
- Message volume trends
- Feature usage statistics
- Rate limit hit rates

### Performance Metrics
- API response times
- Database query performance
- Plugin execution times
- Authentication success rates
- Error frequency analysis

## 🔄 API Response Patterns

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { /* response data */ },
  "metadata": { /* additional info */ }
}
```

### Error Response  
```json
{
  "success": false,
  "error": "Error type",
  "details": "Detailed error message",
  "code": "ERROR_CODE",
  "suggestions": ["Helpful suggestions"]
}
```

### Rate Limited Response
```json
{
  "success": false,
  "error": "Rate limit exceeded", 
  "details": "Specific limit details",
  "usageInfo": { /* current usage stats */ },
  "resetTime": "2024-01-16T00:00:00Z"
}
```

## 🛠️ Architecture

### Core Components
- **Authentication Service** - Multi-provider auth with JWT
- **Rate Limiting Engine** - Subscription-based usage control
- **Provider Manager** - AI service abstraction layer
- **Plugin System** - Extensible tool integration
- **Conversation Engine** - Message flow and history management
- **Usage Tracker** - Real-time usage monitoring and analytics

### Design Patterns
- **Provider Pattern** - Standardized AI service integration
- **Plugin Architecture** - Extensible tool system
- **Repository Pattern** - Data access abstraction
- **Service Layer** - Business logic separation
- **Middleware Pipeline** - Request processing chain

## 🚀 Production Deployment

### Recommended Setup
- **Application**: PM2 process manager
- **Database**: MongoDB Atlas or self-hosted replica set
- **Reverse Proxy**: Nginx with SSL termination
- **Monitoring**: Application and infrastructure monitoring
- **Email**: Production-grade email service
- **Backup**: Automated database backups

### Security Checklist
- [ ] Environment variables secured
- [ ] Database connection encrypted
- [ ] API rate limiting configured
- [ ] CORS properly configured
- [ ] JWT secret rotated regularly
- [ ] Email OTP expiration set
- [ ] Google OAuth properly configured
- [ ] Request logging enabled
- [ ] Error tracking implemented

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Update documentation
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: [Full API Documentation](docs/)
- **Issues**: [GitHub Issues](https://github.com/your-org/apsara-backend/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/apsara-backend/discussions)
- **Email**: support@yourapp.com

---

**Apsara AI Backend** - A comprehensive, production-ready AI conversation platform with enterprise-grade features, flexible authentication, intelligent rate limiting, and powerful plugin system. Built for scale, security, and developer experience. 