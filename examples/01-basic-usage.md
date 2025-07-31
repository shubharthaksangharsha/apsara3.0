# Basic Usage Examples

This guide shows how to get started with the Apsara AI backend API using basic operations.

## Prerequisites

- Apsara backend running on `http://localhost:5000`
- Valid user account (register first)
- User ID and conversation ID

## 1. User Registration and Login

### Register a New User

```bash
curl -X POST http://localhost:5000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "John Doe",
    "email": "john@example.com",
    "password": "securepassword123",
    "acceptTerms": true
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "User registered successfully! Please check your email for verification.",
  "data": {
    "user": {
      "id": "user_id_here",
      "fullName": "John Doe",
      "email": "john@example.com",
      "role": "user",
      "subscriptionPlan": "free"
    }
  }
}
```

### Verify Email with OTP

```bash
curl -X POST http://localhost:5000/api/users/verify-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "otp": "123456"
  }'
```

### Login

```bash
curl -X POST http://localhost:5000/api/users/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "securepassword123"
  }'
```

## 2. Create a Conversation

```bash
curl -X POST http://localhost:5000/api/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id",
    "title": "My First AI Chat",
    "systemInstruction": "You are a helpful AI assistant."
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Conversation created successfully",
  "data": {
    "conversation": {
      "conversationId": "conv_12345",
      "title": "My First AI Chat",
      "userId": "your_user_id",
      "status": "active"
    }
  }
}
```

## 3. Send a Message to AI

```bash
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id",
    "conversationId": "conv_12345",
    "content": "Hello! Can you help me understand AI?",
    "model": "gemini-2.5-flash",
    "provider": "google",
    "config": {
      "temperature": 0.7,
      "maxOutputTokens": 1024,
      "thinkingConfig": {
        "includeThoughts": true,
        "thinkingBudget": 1000
      }
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "AI response generated successfully",
  "data": {
    "userMessage": {
      "messageId": "msg_user_123",
      "content": "Hello! Can you help me understand AI?",
      "messageSequence": 1
    },
    "modelResponse": {
      "messageId": "msg_model_456",
      "content": {
        "text": "Hello! I'd be happy to help you understand AI...",
        "thoughts": "The user is asking about AI basics..."
      },
      "messageSequence": 2
    },
    "metadata": {
      "timing": {
        "requestTime": "2024-01-15T10:30:00Z",
        "responseTime": "2024-01-15T10:30:03Z",
        "processingTimeMs": 3000
      },
      "tokens": {
        "input": 12,
        "output": 150,
        "total": 162
      },
      "provider": {
        "name": "google",
        "model": "gemini-2.5-flash",
        "apiVersion": "2.5"
      }
    }
  }
}
```

## 4. List Conversations

```bash
curl -X GET "http://localhost:5000/api/conversations?userId=your_user_id&limit=10"
```

## 5. Get Conversation History

```bash
curl -X GET "http://localhost:5000/api/conversations/conv_12345/messages?userId=your_user_id"
```

## 6. Edit a Previous Message

```bash
curl -X POST http://localhost:5000/api/ai/edit-message \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id",
    "conversationId": "conv_12345",
    "messageId": "msg_user_123",
    "newContent": "Hello! Can you explain machine learning instead?",
    "model": "gemini-2.5-flash",
    "config": {
      "temperature": 0.8,
      "maxOutputTokens": 1024
    }
  }'
```

## Error Handling

The API returns standard HTTP status codes:

- `200` - Success
- `400` - Bad Request (validation errors)
- `401` - Unauthorized
- `404` - Not Found
- `429` - Rate Limited
- `500` - Internal Server Error

Example error response:
```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "details": "Daily limit exceeded for gemini-2.5-flash. Used 20/20 messages today.",
  "usageInfo": {
    "subscriptionPlan": "free",
    "dailyUsage": {
      "gemini-2.5-flash": {
        "count": 20,
        "limit": 20
      }
    }
  }
}
```

## Next Steps

- Explore [Plugin Usage](02-plugin-usage.md)
- Learn about [Rate Limiting](03-rate-limiting.md)
- Check [Authentication Methods](04-authentication.md) 