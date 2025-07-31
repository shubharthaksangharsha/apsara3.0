# CLI Management Tool Usage

This guide demonstrates how to use Apsara's powerful command-line management tool for database operations, testing, and user management.

## Starting the CLI

```bash
# Start the management tool
npm run manage

# or directly
node scripts/manage-conversations.js
```

## Startup Flow

### User Selection on Startup

```
🚀 Apsara AI Management CLI
===========================
🔍 Checking for existing users...

📊 Available Users:
==================
1. John Doe (john@example.com) - Role: user, Plan: free
   Latest conversations: 3, Last activity: 2024-01-15
2. Alice Smith (alice@example.com) - Role: user, Plan: premium  
   Latest conversations: 7, Last activity: 2024-01-14
3. Guest User abc123 (guest-abc123@apsara.local) - Role: guest, Plan: guest
   Latest conversations: 1, Last activity: 2024-01-15

Choose a user (1-3) or press Enter to continue without selection: 1

👤 User selected: John Doe (john@example.com)
💬 Recent conversations:
   1. AI Development Chat (45 messages)
   2. Plugin Testing (23 messages)
   3. Rate Limiting Discussion (12 messages)
```

## Main Menu Overview

```
🔧 Apsara Management CLI
=======================
Current User: John Doe (john@example.com)

1. Create a new conversation
2. List all conversations  
3. Choose a conversation
4. Send message to AI
5. List messages in conversation
6. Edit a message
7. Call a plugin
8. Create a user
9. List all users
10. Choose/switch user
11. View schema and database info
12. Delete user by email/ID
13. Delete all conversations (all users)
14. Delete specific conversation
15. Full user registration (with OTP)
16. Logout current user
17. Database statistics
18. User-specific statistics  
19. Exit

Enter your choice (1-19): 
```

## Common Use Cases

### 1. User Management

#### Create a Basic User (Option 8)

```
Enter your choice (1-19): 8

👤 Create New User
=================
Enter full name: Bob Wilson
Enter email: bob@example.com
Enter password: securepass123
Enter role (user/admin) [user]: user
Enter subscription plan (guest/free/premium/enterprise) [free]: free

✅ User created successfully!
👤 User Details:
   ID: user_bob123
   Name: Bob Wilson
   Email: bob@example.com
   Role: user
   Plan: free
   Email Verified: false
```

#### Full Registration System (Option 15)

```
Enter your choice (1-19): 15

🔐 Full User Registration & Authentication System
=================================================
1. Register new user (with OTP verification)
2. Login existing user
3. Login with Google OAuth
4. Guest login (5 messages limit)
5. Forgot password (OTP reset)
6. Back to main menu

Choose an option (1-6): 1

📝 User Registration
===================
Enter full name: Sarah Johnson
Enter email: sarah@example.com
Enter password: mypassword123
Confirm password: mypassword123
Accept terms of service? (y/n): y

📧 Sending registration email...
✅ User registered successfully!
📧 Please check your email: sarah@example.com

Enter OTP from email: 456789
🔍 Verifying OTP...
✅ Email verified successfully!
🎉 Registration complete!
👤 User selected: Sarah Johnson
```

#### Google OAuth Login (Option 15 → 3)

```
Choose an option (1-6): 3

🌟 Google OAuth Login
====================
💡 Note: This is a simulation of Google OAuth login
🔧 In production, this would open a browser for Google authentication

Enter your Google email: user@gmail.com
Enter your full name: Google User
🔍 Authenticating with Google...

✅ Google authentication successful!
👤 Welcome, Google User!
🔑 Role: user
📦 Plan: free
🔐 Auth Provider: google
👤 User selected: Google User

💬 Recent Conversations:
   (No conversations yet)

📊 Usage Information:
   Daily Usage: {"gemini-2.5-flash":{"count":0,"limit":20}}
   Total Messages: 0
```

#### Guest Login (Option 15 → 4)

```
Choose an option (1-6): 4

🚀 Guest Login
==============
ℹ️  Guest users get 5 messages total
ℹ️  Access to gemini-2.5-flash model only
ℹ️  Session expires in 24 hours

Do you have an existing guest session ID? (y/n): n
🔄 Creating guest session...

✅ Guest session created successfully!
👤 Welcome, Guest User def456!
🔑 Role: guest
📦 Plan: guest
🆔 Session ID: def456
👤 User selected: Guest User def456

🎯 Guest Limitations:
   Total Messages Limit: 5
   Messages Used: 0
   Messages Remaining: 5
   Available Models: gemini-2.5-flash
   Session Duration: 24 hours
```

### 2. Conversation Management

#### Create a Conversation (Option 1)

```
Enter your choice (1-19): 1

💬 Create New Conversation
=========================
Enter conversation title: Testing Rate Limits
Enter system instruction (optional): You are a helpful assistant that explains technical concepts clearly.

✅ Conversation created successfully!
📝 Conversation Details:
   ID: conv_rate_test_123
   Title: Testing Rate Limits
   User: John Doe
   System Instruction: You are a helpful assistant that explains technical concepts clearly.
   Status: active
   Messages: 0
   Tokens: 0
```

#### Send Message to AI (Option 4)

```
Enter your choice (1-19): 4

🤖 Send Message to AI
====================
Current User: John Doe (john@example.com)
Current Conversation: Testing Rate Limits (conv_rate_test_123)

Enter your message: Can you explain how rate limiting works in APIs?
Enter model (default: gemini-2.5-flash): 
Enter temperature (0.0-2.0, default: 0.7): 0.8
Enter max output tokens (default: 2048): 1024
Configure thinking? (y/n, default: y): y
  Thinking budget (-1 for dynamic, 0 for off, or custom): 1000
  Include thoughts in response? (y/n): y

🤖 Sending message to AI...

✅ Message sent successfully!

📤 Your Message (ID: msg_user_789, Sequence: 1):
"Can you explain how rate limiting works in APIs?"

🤖 AI Response (ID: msg_model_790, Sequence: 2):
"Rate limiting in APIs is a crucial mechanism for controlling the number of requests a client can make to an API within a specific time window..."

💭 AI Thoughts:
"The user is asking about rate limiting, which is an important topic for API design. I should explain both the concept and practical implementation..."

📊 Response Metadata:
   Model: gemini-2.5-flash (google)
   Temperature: 0.8
   Tokens: Input: 12, Output: 156, Total: 168
   Processing Time: 2.3s
   Thinking Tokens: 45

🎯 Usage Summary:
   Plan: free
   Remaining Today: gemini-2.5-flash: 19/20, gemini-2.5-pro: 5/5
```

#### Edit a Message (Option 6)

```
Enter your choice (1-19): 6

✏️ Edit Message
===============
Current Conversation: Testing Rate Limits

📝 User Messages in Conversation:
==============================
1. [msg_user_789] (Seq: 1): "Can you explain how rate limiting works in APIs?"

Select message to edit (1-1): 1

Current content: "Can you explain how rate limiting works in APIs?"
Enter new message content: Can you explain rate limiting in APIs with specific examples?

Enter model for regeneration (default: gemini-2.5-flash): 
Enter temperature (default: 0.7): 0.9
Enter max output tokens (default: 2048): 
Configure thinking? (y/n, default: y): y

🔄 Editing message and regenerating response...

✅ Message edited successfully!

📤 Edited Message (ID: msg_user_789, Sequence: 1):
"Can you explain rate limiting in APIs with specific examples?"

🗑️ Deleted 1 subsequent message(s)

🤖 New AI Response (ID: msg_model_791, Sequence: 2):
"Certainly! Rate limiting in APIs involves controlling request frequency. Here are specific examples:

1. **GitHub API**: 5,000 requests per hour for authenticated users
2. **Twitter API**: 300 requests per 15-minute window
3. **Stripe API**: 100 requests per second..."

📊 Response Metadata:
   Model: gemini-2.5-flash
   Temperature: 0.9
   Tokens Used: 189 total
```

### 3. Plugin Testing

#### Call Calculator Plugin (Option 7)

```
Enter your choice (1-19): 7

🔧 Call Plugin
=============
Available plugins:
1. calculator - Performs basic mathematical operations
2. echo - Echoes back the provided message

Select plugin (1-2): 1

📊 Calculator Plugin Parameters:
   - number1: First number
   - number2: Second number
   - operation: add, subtract, multiply, divide

Enter number1: 25
Enter number2: 8
Enter operation (add/subtract/multiply/divide): multiply

Run asynchronously? (y/n): n
Send result to AI model for analysis? (y/n): y

🔧 Executing plugin...

✅ Plugin executed successfully!

🔧 Plugin Result (ID: msg_plugin_792, Sequence: 3):
{
  "operation": "25 × 8",
  "result": 200,
  "success": true
}

🤖 AI Analysis (ID: msg_model_793, Sequence: 4):
"The calculation 25 × 8 = 200 is correct! This is a straightforward multiplication. Some interesting facts about 200:
- It's divisible by 1, 2, 4, 5, 8, 10, 20, 25, 40, 50, 100, and 200
- It's 2³ × 5²
- It's the HTTP status code for 'OK'"

📊 Plugin Metadata:
   Plugin: calculator (google)
   Execution: synchronous
   AI Response: included
   Total Time: 1.8s
```

#### Async Plugin Execution

```
Run asynchronously? (y/n): y
Send result to AI model for analysis? (y/n): y

🔧 Starting async plugin execution...

✅ Plugin started asynchronously!
🆔 Task ID: task_async_456
📊 Status: started
💡 Check conversation messages later to see results

⏰ The plugin will execute in the background and store results in the database.
```

### 4. User Statistics and Analytics

#### User-Specific Statistics (Option 18)

```
Enter your choice (1-19): 18

🔐 Verify Identity for Statistics Access
======================================
Enter your email: john@example.com
Enter your password: ********
✅ Password verification successful!

📊 Your Personal Statistics:
============================
👤 User: John Doe (john@example.com)
🔑 Role: user
📦 Plan: free
📅 Member Since: 1/1/2024

💬 Conversation Statistics:
   Total Conversations: 8
   New Conversations (24h): 2

📝 Message Statistics:
   Total Messages: 156
   New Messages (24h): 23

🎯 Token Usage:
   Total Tokens Used: 12,450

🤖 Your Model Usage:
   gemini-2.5-flash: 89 messages
   gemini-2.5-pro: 12 messages

🔥 Most Active Conversations:
   1. AI Development Chat (45 messages, 2,340 tokens)
      Last Activity: 1/14/2024
   2. Plugin Testing (23 messages, 1,890 tokens)
      Last Activity: 1/13/2024
   3. Rate Limiting Discussion (18 messages, 1,234 tokens)
      Last Activity: 1/12/2024

📊 Message Distribution:
   user: 78 messages
   model: 78 messages
   plugin: 4 messages
```

#### Database Statistics (Option 17)

```
Enter your choice (1-19): 17

📊 Database Statistics
=====================
👥 Users: 45 total
   - user: 42 (93.3%)
   - admin: 2 (4.4%)  
   - guest: 1 (2.2%)

📦 Subscription Plans:
   - free: 38 (84.4%)
   - premium: 4 (8.9%)
   - guest: 2 (4.4%)
   - enterprise: 1 (2.2%)

💬 Conversations: 234 total
   - active: 198 (84.6%)
   - archived: 36 (15.4%)

📝 Messages: 5,678 total
   - user: 2,839 (50.0%)
   - model: 2,801 (49.3%)
   - plugin: 38 (0.7%)

🎯 Token Usage:
   Total Tokens: 1,234,567
   Average per Message: 217 tokens

📈 Recent Activity (24h):
   New Users: 3
   New Conversations: 12
   New Messages: 89
   Token Usage: 19,234
```

### 5. Advanced Operations

#### Delete Operations

**Delete Specific Conversation (Option 14):**
```
Enter your choice (1-19): 14

🗑️ Delete Specific Conversation
===============================
Current User: John Doe

📝 Your Conversations:
=====================
1. [conv_123] AI Development Chat (45 messages) - Updated: 2024-01-15
2. [conv_456] Plugin Testing (23 messages) - Updated: 2024-01-14
3. [conv_789] Rate Limiting Discussion (18 messages) - Updated: 2024-01-12

Select conversation to delete (1-3): 2
⚠️ Are you sure you want to delete "Plugin Testing"? This will also delete all 23 messages. (y/N): y

🗑️ Deleting conversation and messages...
✅ Deleted conversation: Plugin Testing
✅ Deleted 23 associated messages
```

**Delete All Conversations (Option 13):**
```
Enter your choice (1-19): 13

⚠️ DELETE ALL CONVERSATIONS
============================
This will delete ALL conversations and messages for ALL users!

Current database contents:
- 234 conversations
- 5,678 messages
- Across 45 users

⚠️ Type "DELETE ALL CONVERSATIONS" to confirm: DELETE ALL CONVERSATIONS
⚠️ Are you absolutely sure? (yes/no): yes

🗑️ Deleting all conversations and messages...
✅ Deleted 234 conversations
✅ Deleted 5,678 messages
💡 All conversation data has been permanently removed
```

#### Logout (Option 16)

```
Enter your choice (1-19): 16

🔓 Logging out user: John Doe (john@example.com)
✅ User logged out successfully!
💡 You can select a new user from the startup menu or login via full registration system
```

## CLI Best Practices

### 1. User Management Workflow

```bash
# 1. Start CLI
npm run manage

# 2. Select or create user
# 3. Create conversation
# 4. Test functionality
# 5. Review statistics
# 6. Clean up if needed
```

### 2. Testing Scenarios

```bash
# Test rate limiting
# 1. Create guest user
# 2. Send 5 messages quickly
# 3. Try 6th message (should fail)
# 4. Switch to free user
# 5. Test higher limits
```

### 3. Development Debugging

```bash
# 1. Use database statistics to monitor usage
# 2. Check user-specific stats for individual analysis  
# 3. Test different authentication methods
# 4. Verify plugin functionality
# 5. Test message editing and conversation flow
```

## Error Handling Examples

### Rate Limit Testing

```
🤖 Sending message to AI...
❌ Error sending message: Rate limit exceeded
Details: Guest limit exceeded. You have used 5/5 messages.

💡 Suggestions:
   - Register for a free account (20 daily messages)
   - Upgrade to premium (100 daily messages)
   - Try again tomorrow
```

### Authentication Errors

```
🔐 Verify Identity for Statistics Access
======================================
Enter your email: john@example.com
Enter your password: wrong_password
❌ Password verification failed

💡 Options:
   - Try again with correct password
   - Use "Forgot Password" option
   - Contact administrator
```

### Plugin Errors

```
🔧 Executing plugin...
❌ Plugin execution failed: number1 must be a number

💡 Check your input parameters:
   - number1: "abc" (invalid - must be number)
   - number2: 5 (valid)
   - operation: "add" (valid)
```

## Next Steps

- Explore [Advanced Examples](05-advanced-examples.md)
- Check [API Reference Documentation](07-api-reference.md)
- Learn about [Deployment](08-deployment.md) 