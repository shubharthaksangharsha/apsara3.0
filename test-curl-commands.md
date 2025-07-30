## 🤖 AI Generation

### Generate Content with Conversation History
```bash
# First, create a conversation
curl -X POST http://localhost:5000/api/conversations \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_ID_HERE",
    "title": "Test Conversation",
    "type": "rest",
    "config": {
      "rest": {
        "systemInstruction": "You are a helpful assistant",
        "temperature": 0.7
      }
    }
  }'

# Then send messages with conversation history
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_ID_HERE",
    "conversationId": "CONVERSATION_ID_HERE",
    "contents": "Hello, how are you?",
    "model": "gemini-2.5-flash",
    "config": {
      "temperature": 0.7,
      "maxOutputTokens": 2048,
      "thinkingConfig": {
        "thinkingBudget": -1,
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

### Simple AI Generation (No History)
```bash
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_ID_HERE",
    "conversationId": "CONVERSATION_ID_HERE",
    "contents": "What is the capital of France?",
    "model": "gemini-2.5-flash",
    "config": {
      "conversationHistory": {
        "include": false
      }
    }
  }'
```

### AI Generation with Thinking
```bash
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_ID_HERE",
    "conversationId": "CONVERSATION_ID_HERE",
    "contents": "Solve this complex math problem: If x^2 + 5x + 6 = 0, what are the values of x?",
    "model": "gemini-2.5-pro",
    "config": {
      "thinkingConfig": {
        "thinkingBudget": 2048,
        "includeThoughts": true
      },
      "conversationHistory": {
        "include": true,
        "maxMessages": 10
      }
    }
  }'
``` 