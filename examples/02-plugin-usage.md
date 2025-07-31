# Plugin Usage Examples

This guide demonstrates how to use Apsara's plugin system for extending AI capabilities with external tools.

## Available Plugins

Apsara currently supports these plugins:

1. **Calculator** - Perform mathematical operations
2. **Echo** - Echo back messages (useful for testing)

## Plugin Architecture

- **Provider-based**: `/api/plugins/{provider}/{plugin}/send`
- **Synchronous & Asynchronous**: Control execution mode with `runAsync`
- **AI Integration**: Use `sendToModel` to pass results back to AI

## 1. List Available Plugins

```bash
curl -X GET http://localhost:5000/api/plugins/list_plugins
```

**Response:**
```json
{
  "success": true,
  "providers": {
    "google": {
      "calculator": {
        "name": "calculator",
        "description": "Performs basic mathematical operations",
        "parameters": {
          "number1": "First number",
          "number2": "Second number", 
          "operation": "add, subtract, multiply, divide"
        }
      },
      "echo": {
        "name": "echo",
        "description": "Echoes back the provided message",
        "parameters": {
          "message": "Message to echo back"
        }
      }
    }
  }
}
```

## 2. Calculator Plugin Examples

### Basic Calculator (Synchronous)

```bash
curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id",
    "conversationId": "conv_12345",
    "parameters": {
      "number1": 15,
      "number2": 7,
      "operation": "add"
    },
    "sendToModel": false,
    "runAsync": false
  }'
```

**Response:**
```json
{
  "success": true,
  "plugin": "calculator",
  "provider": "google",
  "conversationId": "conv_12345",
  "messageId": "msg_plugin_789",
  "messageSequence": 3,
  "result": {
    "operation": "15 + 7",
    "result": 22,
    "success": true
  },
  "sendToModel": false,
  "runAsync": false
}
```

### Calculator with AI Analysis (Synchronous)

```bash
curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id",
    "conversationId": "conv_12345",
    "parameters": {
      "number1": 144,
      "number2": 12,
      "operation": "divide"
    },
    "sendToModel": true,
    "runAsync": false,
    "modelConfig": {
      "model": "gemini-2.5-flash",
      "provider": "google",
      "temperature": 0.7,
      "maxOutputTokens": 1024,
      "thinkingConfig": {
        "includeThoughts": true,
        "thinkingBudget": 500
      }
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "plugin": "calculator",
  "provider": "google",
  "conversationId": "conv_12345",
  "messageId": "msg_plugin_790",
  "messageSequence": 4,
  "result": {
    "operation": "144 ÷ 12",
    "result": 12,
    "success": true
  },
  "aiResponse": {
    "messageId": "msg_model_791",
    "messageSequence": 5,
    "content": {
      "text": "The calculation 144 ÷ 12 = 12 is correct. This is a perfect division with no remainder. Fun fact: 12 is both the result and the divisor in this case!",
      "thoughts": "The user performed a division operation. The result is a clean integer..."
    },
    "metadata": {
      "tokens": {
        "input": 25,
        "output": 45,
        "total": 70
      }
    }
  },
  "sendToModel": true,
  "runAsync": false
}
```

### Asynchronous Calculator

```bash
curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id",
    "conversationId": "conv_12345",
    "parameters": {
      "number1": 9,
      "number2": 3,
      "operation": "multiply"
    },
    "sendToModel": true,
    "runAsync": true,
    "modelConfig": {
      "model": "gemini-2.5-flash",
      "provider": "google"
    }
  }'
```

**Immediate Response:**
```json
{
  "success": true,
  "plugin": "calculator",
  "provider": "google",
  "conversationId": "conv_12345",
  "taskId": "task_abc123",
  "status": "started",
  "message": "Plugin execution started asynchronously",
  "runAsync": true
}
```

The plugin executes in the background and stores both the plugin result and AI response in the database. You can check conversation messages to see the results.

## 3. Echo Plugin Examples

### Simple Echo

```bash
curl -X POST http://localhost:5000/api/plugins/google/echo/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id",
    "conversationId": "conv_12345",
    "parameters": {
      "message": "Hello, Apsara!"
    },
    "sendToModel": false,
    "runAsync": false
  }'
```

**Response:**
```json
{
  "success": true,
  "plugin": "echo",
  "provider": "google",
  "conversationId": "conv_12345",
  "messageId": "msg_plugin_800",
  "messageSequence": 6,
  "result": {
    "originalMessage": "Hello, Apsara!",
    "echo": "Hello, Apsara!",
    "timestamp": "2024-01-15T10:35:00Z"
  },
  "sendToModel": false,
  "runAsync": false
}
```

### Echo with AI Response

```bash
curl -X POST http://localhost:5000/api/plugins/google/echo/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id",
    "conversationId": "conv_12345",
    "parameters": {
      "message": "Testing echo functionality"
    },
    "sendToModel": true,
    "runAsync": false
  }'
```

## 4. Advanced Plugin Workflows

### Complex Mathematical Analysis

```bash
# Step 1: Calculate
curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id",
    "conversationId": "conv_12345",
    "parameters": {
      "number1": 256,
      "number2": 16,
      "operation": "divide"
    },
    "sendToModel": true,
    "runAsync": false,
    "modelConfig": {
      "model": "gemini-2.5-pro",
      "temperature": 0.3,
      "thinkingConfig": {
        "includeThoughts": true,
        "thinkingBudget": 2000
      }
    }
  }'

# Step 2: Follow up with another calculation
curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id",
    "conversationId": "conv_12345",
    "parameters": {
      "number1": 16,
      "number2": 4,
      "operation": "multiply"
    },
    "sendToModel": true,
    "runAsync": false
  }'
```

### Async Processing Chain

```bash
# Start multiple async operations
curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id",
    "conversationId": "conv_12345",
    "parameters": {"number1": 100, "number2": 25, "operation": "divide"},
    "sendToModel": true,
    "runAsync": true
  }'

curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id", 
    "conversationId": "conv_12345",
    "parameters": {"number1": 50, "number2": 8, "operation": "subtract"},
    "sendToModel": true,
    "runAsync": true
  }'
```

## 5. Error Handling

### Invalid Parameters

```bash
curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id",
    "conversationId": "conv_12345",
    "parameters": {
      "number1": "invalid",
      "number2": 5,
      "operation": "add"
    },
    "sendToModel": false,
    "runAsync": false
  }'
```

**Error Response:**
```json
{
  "success": false,
  "error": "Plugin execution failed",
  "details": "number1 must be a number",
  "plugin": "calculator",
  "provider": "google"
}
```

### Division by Zero

```bash
curl -X POST http://localhost:5000/api/plugins/google/calculator/send \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "your_user_id",
    "conversationId": "conv_12345",
    "parameters": {
      "number1": 10,
      "number2": 0,
      "operation": "divide"
    },
    "sendToModel": false,
    "runAsync": false
  }'
```

**Error Response:**
```json
{
  "success": false,
  "error": "Plugin execution failed",
  "details": "Division by zero is not allowed",
  "plugin": "calculator",
  "provider": "google"
}
```

## 6. Best Practices

### When to Use `sendToModel`

- **True**: When you want AI analysis of plugin results
- **False**: When you just need the raw plugin output

### When to Use `runAsync`

- **True**: For long-running operations or when you don't need immediate results
- **False**: For quick operations where you need immediate response

### Model Configuration

When `sendToModel: true`, provide appropriate model config:

```json
{
  "modelConfig": {
    "model": "gemini-2.5-flash",  // or "gemini-2.5-pro" for complex analysis
    "temperature": 0.7,           // Higher for creative responses
    "maxOutputTokens": 1024,      // Adjust based on expected response length
    "thinkingConfig": {
      "includeThoughts": true,    // Get AI reasoning
      "thinkingBudget": 1000      // Tokens for thinking process
    }
  }
}
```

## Next Steps

- Learn about [Rate Limiting](03-rate-limiting.md)
- Explore [Authentication Methods](04-authentication.md)
- Check [Advanced Examples](05-advanced-examples.md) 