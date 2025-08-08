# Apsara AI Backend

A production-ready AI conversation platform with multi-provider support, intelligent file management, and comprehensive authentication.

## 🚀 Quick Start

```bash
# Clone and install
git clone <repository-url>
cd apsara3.0
npm install

# Configure environment
cp env.template .env
# Edit .env with your API keys

# Start development
npm run dev

# Interactive management
npm run manage
```

## ✨ Key Features

### 🤖 AI Integration
- **Multi-Provider Support**: Google Gemini (extensible for Claude, GPT, xAI)
- **Streaming Architecture**: Internal streaming for optimal performance
- **Thinking Models**: Advanced reasoning with Gemini 2.5 series
- **Conversation History**: Automatic context management
- **Message Editing**: Edit and regenerate responses

### 🔐 Authentication & Security
- **Multiple Auth Methods**: Email/password, Google OAuth, guest login
- **Role-Based Access**: User, admin, guest roles
- **Rate Limiting**: Subscription-based usage control
- **JWT Security**: Secure token-based authentication

### 📁 Smart File Management
- **Intelligent Upload**: Auto-selects optimal storage based on file size/count
- **Multi-Storage Support**: Local, S3, Google File API
- **AI Processing**: Seamless multimodal file analysis
- **Storage Preferences**: Speed, processing, or storage optimization

### 🎯 Rate Limiting System

| Plan | gemini-2.5-flash | gemini-2.5-pro | Features |
|------|------------------|------------------|----------|
| **Guest** | 5 total messages | ❌ No access | Trial access |
| **Free** | 20/day | 5/day | Full features |
| **Premium** | 100/day | 50/day | Priority support |

### 🔌 Plugin System
- **Provider-based Architecture**: `/api/plugins/{provider}/{plugin}/send`
- **Sync/Async Execution**: Background processing support
- **AI Integration**: Intelligent plugin result analysis
- **Built-in Tools**: Calculator, Echo plugins

## 📊 Core API Endpoints

### Authentication
```bash
POST /users/register        # Register with OTP
POST /users/login           # Email/password login
POST /users/google-auth     # Google OAuth
POST /users/guest-login     # Guest session (5 messages)
```

### AI Generation
```bash
POST /ai/generate           # Generate AI response
POST /ai/edit-message       # Edit and regenerate
POST /ai/regenerate         # Regenerate response
```

### Smart File Upload
```bash
POST /files/smart-upload    # Intelligent upload (recommended)
POST /files/upload          # Manual storage selection
GET  /files                 # List user files
```

### Plugins
```bash
GET  /plugins/list_plugins  # List available plugins
POST /plugins/:provider/:plugin/send  # Execute plugin
```

## 🧠 Smart Upload System

### How Preferences Work

#### 🚀 **Speed Preference**
- **Priority**: Fast upload/download
- **Logic**: Prefers local storage for files ≤20MB
- **Use Case**: Quick prototyping, development
- **Benefit**: Minimal latency, immediate access

#### 🤖 **Processing Preference** (Default)
- **Priority**: AI processing optimization
- **Logic**: Uses Google File API for files >20MB or >3 files
- **Use Case**: AI analysis, multimodal processing
- **Benefit**: Direct AI compatibility, no conversion needed

#### 💾 **Storage Preference**
- **Priority**: Long-term retention
- **Logic**: Prefers persistent storage (local/S3)
- **Use Case**: Document archival, permanent storage
- **Benefit**: No expiration, permanent access

### Decision Matrix

| File Size | File Count | Speed | Processing | Storage |
|-----------|------------|-------|------------|---------|
| <5MB | 1-2 files | **Local** | **Local** | **Local** |
| 5-20MB | 1-2 files | **Local** | **Local** | **Local** |
| >20MB | Any | **Google API** | **Google API** | **Local** |
| Any | >3 files | **Local** | **Google API** | **Local** |

## 🛠️ Management CLI

Interactive tool with 21 comprehensive options:

```bash
npm run manage
```

**Key Features:**
- Complete user registration/authentication flow
- Conversation management and message editing
- File upload with AI analysis
- Plugin testing and execution
- Database statistics and user analytics
- Response regeneration with different models

## 🗂️ Database Models

- **User**: Authentication, profiles, subscription plans
- **UserUsage**: Rate limiting, usage tracking, daily resets
- **Conversation**: Chat sessions with system instructions
- **Message**: Individual messages with metadata
- **File**: File storage with multi-provider support

## ⚙️ Environment Configuration

```env
# Required Configuration
MONGODB_URI=your_mongodb_connection
GOOGLE_GEMINI_API_KEY=your_google_api_key
JWT_SECRET=your_jwt_secret
EMAIL_USERNAME=your_email
EMAIL_PASSWORD=your_email_password

# File Upload Thresholds
SMALL_FILE_THRESHOLD=5242880      # 5MB
LARGE_FILE_THRESHOLD=20971520     # 20MB
TOTAL_SIZE_THRESHOLD=52428800     # 50MB
MULTIPLE_FILES_THRESHOLD=3        # files

# Optional
GOOGLE_CLIENT_ID=oauth_client_id
GOOGLE_CLIENT_SECRET=oauth_secret
```

## 🚀 Example Usage

### Smart File Upload with AI Analysis
```bash
curl -X POST http://localhost:5000/api/files/smart-upload \
  -F "files=@document.pdf" \
  -F "userId=user123" \
  -F "aiProvider=google" \
  -F "preference=processing"
```

### AI Generation with Files
```bash
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "conversationId": "conv456",
    "contents": "Analyze this document",
    "files": ["file_123456789"],
    "model": "gemini-2.5-pro",
    "provider": "google"
  }'
```

### Plugin Execution
```bash
curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "parameters": {
      "number1": 15,
      "number2": 7,
      "operation": "multiply"
    },
    "sendToModel": true
  }'
```

## 🔍 Route Provider Parameters

All major routes accept `provider` parameter (defaults to `google`):

- **AI Routes**: `/ai/generate`, `/ai/edit-message`, `/ai/regenerate`
- **File Routes**: `/files/upload`, `/files/smart-upload`
- **Plugin Routes**: `/plugins/:provider/:plugin/send`
- **Session Routes**: `/sessions/live-api`

## 📈 Architecture

- **Provider System**: Abstracted AI service integration
- **Plugin Architecture**: Extensible tool framework
- **Rate Limiting Engine**: Subscription-based usage control
- **Smart File Manager**: Intelligent storage selection
- **Streaming Core**: Internal streaming for all AI operations

## 🛡️ Security Features

- JWT token authentication with configurable expiration
- Bcrypt password hashing with salt rounds
- CORS protection and request rate limiting
- OTP-based email verification and password reset
- Role-based access control (user/admin/guest)

---

**Apsara AI Backend** - Enterprise-grade AI conversation platform with intelligent file management, multi-provider support, and comprehensive authentication. Built for scale, security, and developer experience.