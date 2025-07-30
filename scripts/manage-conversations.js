#!/usr/bin/env node

import mongoose from 'mongoose';
import readline from 'readline';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env') });

// Import models
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import User from '../src/models/User.js';

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

class ConversationManager {
  constructor() {
    this.currentConversation = null;
    this.currentUser = null;
  }

  async connect() {
    try {
      const connectionString = process.env.MONGODB_URI?.replace('<db_password>', process.env.DB_PASSWORD);
      await mongoose.connect(connectionString, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        bufferCommands: false
      });
      console.log('✅ Connected to MongoDB Atlas');
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error.message);
      process.exit(1);
    }
  }

  async disconnect() {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }

  question(prompt) {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  }

  async showMainMenu() {
    console.log('\n🚀 Apsara Conversation Manager');
    console.log('================================');
    console.log('1. Create a conversation');
    console.log('2. List conversations');
    console.log('3. Choose a conversation');
    console.log('4. View conversation messages');
    console.log('5. Send message to AI');
    console.log('6. Edit a message');
    console.log('7. Call plugin');
    console.log('8. Create a user');
    console.log('9. List users');
    console.log('10. Choose a user');
    console.log('11. Delete a user');
    console.log('12. Delete all users');
    console.log('13. Database statistics');
    console.log('14. Exit');
    console.log('================================');
    
    if (this.currentUser) {
      console.log(`👤 Current User: ${this.currentUser.fullName} (${this.currentUser.email})`);
    }
    if (this.currentConversation) {
      console.log(`💬 Current Conversation: ${this.currentConversation.title}`);
    }
    console.log('');

    const choice = await this.question('Enter your choice (1-14): ');
    return choice.trim();
  }

  async createConversation() {
    if (!this.currentUser) {
      console.log('❌ Please select a user first (option 9)');
      return;
    }

    const title = await this.question('Enter conversation title: ');
    const systemInstruction = await this.question('Enter system instruction (optional): ');

    try {
      const { v4: uuidv4 } = await import('uuid');
      const conversation = new Conversation({
        conversationId: uuidv4(),
        userId: this.currentUser._id.toString(),
        title: title || 'New Conversation',
        type: 'rest',
        config: {
          rest: {
            systemInstruction: systemInstruction || undefined,
            temperature: 0.7,
            maxOutputTokens: 2048
          }
        }
      });

      await conversation.save();
      console.log('✅ Conversation created successfully!');
      console.log(`🆔 ID: ${conversation.conversationId}`);
      console.log(`📝 Title: ${conversation.title}`);
      
      this.currentConversation = conversation;
    } catch (error) {
      console.error('❌ Error creating conversation:', error.message);
    }
  }

  async listConversations() {
    const filter = this.currentUser ? { userId: this.currentUser._id.toString() } : {};
    const limit = parseInt(await this.question('Enter limit (default: 10): ') || '10');

    try {
      const conversations = await Conversation
        .find(filter)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .select('conversationId title status createdAt updatedAt stats userId');

      if (conversations.length === 0) {
        console.log('📭 No conversations found');
        return;
      }

      console.log('\n📋 Conversations:');
      console.log('================');
      
      for (let i = 0; i < conversations.length; i++) {
        const conv = conversations[i];
        const user = await User.findById(conv.userId).select('fullName email');
        console.log(`${i + 1}. ${conv.title}`);
        console.log(`   🆔 ID: ${conv.conversationId}`);
        console.log(`   👤 User: ${user?.fullName || 'Unknown'} (${user?.email || 'Unknown'})`);
        console.log(`   📊 Status: ${conv.status}`);
        console.log(`   💬 Messages: ${conv.stats?.totalMessages || 0}`);
        console.log(`   🕒 Created: ${conv.createdAt?.toLocaleString()}`);
        console.log(`   🕒 Updated: ${conv.updatedAt?.toLocaleString()}`);
        console.log('');
      }
    } catch (error) {
      console.error('❌ Error listing conversations:', error.message);
    }
  }

  async chooseConversation() {
    if (!this.currentUser) {
      console.log('❌ Please select a user first (option 9)');
      return;
    }

    try {
      const conversations = await Conversation
        .find({ userId: this.currentUser._id.toString() })
        .sort({ updatedAt: -1 })
        .limit(20);

      if (conversations.length === 0) {
        console.log('📭 No conversations found for this user');
        console.log('💡 You can create a new conversation (option 1)');
        return;
      }

      console.log('\n💬 Your Conversations:');
      console.log('=====================');
      conversations.forEach((conv, index) => {
        console.log(`${index + 1}. ${conv.title}`);
        console.log(`   🆔 ID: ${conv.conversationId}`);
        console.log(`   📊 Status: ${conv.status} | 💬 Messages: ${conv.stats?.totalMessages || 0}`);
        console.log(`   🕒 Updated: ${conv.updatedAt?.toLocaleString()}`);
        if (conv.config?.rest?.systemInstruction) {
          console.log(`   🎯 System: ${conv.config.rest.systemInstruction.substring(0, 60)}${conv.config.rest.systemInstruction.length > 60 ? '...' : ''}`);
        }
        console.log('');
      });

      const choice = await this.question(`Select a conversation (1-${conversations.length}): `);
      const convIndex = parseInt(choice) - 1;

      if (convIndex >= 0 && convIndex < conversations.length) {
        this.currentConversation = conversations[convIndex];
        console.log('✅ Conversation selected!');
        console.log(`📝 Title: ${this.currentConversation.title}`);
        console.log(`📊 Status: ${this.currentConversation.status}`);
        console.log(`💬 Total Messages: ${this.currentConversation.stats?.totalMessages || 0}`);
        if (this.currentConversation.config?.rest?.systemInstruction) {
          console.log(`🎯 System Instruction: ${this.currentConversation.config.rest.systemInstruction}`);
        }
      } else {
        console.log('❌ Invalid selection');
      }
    } catch (error) {
      console.error('❌ Error choosing conversation:', error.message);
    }
  }

  async viewConversationMessages() {
    if (!this.currentConversation) {
      console.log('❌ Please select a conversation first (option 3)');
      return;
    }

    const limit = parseInt(await this.question('Enter limit (default: 20): ') || '20');

    try {
      const messages = await Message
        .find({ conversationId: this.currentConversation.conversationId })
        .sort({ createdAt: 1 })
        .limit(limit)
        .select('messageId role content metadata status createdAt');

      if (messages.length === 0) {
        console.log('📭 No messages found in this conversation');
        return;
      }

      console.log(`\n💬 Messages in "${this.currentConversation.title}":`);
      console.log('==========================================');
      
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const roleIcon = msg.role === 'user' ? '👤' : msg.role === 'model' ? '🤖' : '⚙️';
        
        console.log(`${i + 1}. ${roleIcon} ${msg.role.toUpperCase()}`);
        console.log(`   🆔 ID: ${msg.messageId}`);
        console.log(`   📝 Content: ${msg.content?.text?.substring(0, 100)}${msg.content?.text?.length > 100 ? '...' : ''}`);
        
        if (msg.content?.thoughts) {
          console.log(`   🧠 Thoughts: ${msg.content.thoughts.substring(0, 100)}${msg.content.thoughts.length > 100 ? '...' : ''}`);
        }
        
        console.log(`   📊 Status: ${msg.status}`);
        console.log(`   🕒 Created: ${msg.createdAt?.toLocaleString()}`);
        
        if (msg.metadata?.tokens) {
          console.log(`   🎯 Tokens: Input(${msg.metadata.tokens.input}) Output(${msg.metadata.tokens.output}) Total(${msg.metadata.tokens.total})`);
        }
        
        console.log('');
      }
    } catch (error) {
      console.error('❌ Error viewing messages:', error.message);
    }
  }

  async createUser() {
    const fullName = await this.question('Enter full name: ');
    const email = await this.question('Enter email: ');
    const password = await this.question('Enter password: ');

    try {
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        console.log('❌ User with this email already exists');
        return;
      }

      const user = new User({
        fullName,
        email: email.toLowerCase(),
        password,
        isEmailVerified: true // For testing purposes
      });

      await user.save();
      console.log('✅ User created successfully!');
      console.log(`👤 Name: ${user.fullName}`);
      console.log(`📧 Email: ${user.email}`);
      console.log(`🆔 ID: ${user._id}`);
      
      this.currentUser = user;
    } catch (error) {
      console.error('❌ Error creating user:', error.message);
    }
  }

  async listUsers() {
    const limit = parseInt(await this.question('Enter limit (default: 10): ') || '10');

    try {
      const users = await User
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('fullName email role subscriptionPlan createdAt usage');

      if (users.length === 0) {
        console.log('📭 No users found');
        return;
      }

      console.log('\n👥 Users:');
      console.log('=========');
      
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        console.log(`${i + 1}. ${user.fullName}`);
        console.log(`   📧 Email: ${user.email}`);
        console.log(`   🔑 Role: ${user.role}`);
        console.log(`   📦 Plan: ${user.subscriptionPlan}`);
        console.log(`   📊 Requests: ${user.usage?.totalRequests || 0}`);
        console.log(`   🕒 Created: ${user.createdAt?.toLocaleString()}`);
        console.log(`   🕒 Last Login: ${user.usage?.lastLogin?.toLocaleString() || 'Never'}`);
        console.log('');
      }
    } catch (error) {
      console.error('❌ Error listing users:', error.message);
    }
  }

  async chooseUser() {
    const email = await this.question('Enter user email: ');

    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        console.log('❌ User not found');
        return;
      }

      this.currentUser = user;
      console.log('✅ User selected!');
      console.log(`👤 Name: ${user.fullName}`);
      console.log(`📧 Email: ${user.email}`);
      console.log(`🔑 Role: ${user.role}`);
      console.log(`📦 Plan: ${user.subscriptionPlan}`);
    } catch (error) {
      console.error('❌ Error choosing user:', error.message);
    }
  }

  async deleteUser() {
    const identifier = await this.question('Enter user email or user ID: ');

    try {
      // Try to find by email first, then by ID
      let user = await User.findOne({ email: identifier.toLowerCase() });
      if (!user) {
        user = await User.findById(identifier);
      }

      if (!user) {
        console.log('❌ User not found');
        return;
      }

      console.log(`⚠️ You are about to delete user: ${user.fullName} (${user.email})`);
      const confirm = await this.question('Are you sure? Type "DELETE" to confirm: ');

      if (confirm !== 'DELETE') {
        console.log('❌ Deletion cancelled');
        return;
      }

      // Delete user's conversations and messages
      const conversationCount = await Conversation.countDocuments({ userId: user._id.toString() });
      const messageCount = await Message.countDocuments({ userId: user._id.toString() });

      await Promise.all([
        Conversation.deleteMany({ userId: user._id.toString() }),
        Message.deleteMany({ userId: user._id.toString() }),
        User.deleteOne({ _id: user._id })
      ]);

      console.log('✅ User deleted successfully!');
      console.log(`📊 Deleted: User + ${conversationCount} conversations + ${messageCount} messages`);

      // Clear current user if it was the deleted user
      if (this.currentUser && this.currentUser._id.toString() === user._id.toString()) {
        this.currentUser = null;
        this.currentConversation = null;
        console.log('⚠️ Current user was deleted. Please select a new user.');
      }

    } catch (error) {
      console.error('❌ Error deleting user:', error.message);
    }
  }

  async deleteAllUsers() {
    console.log('⚠️⚠️⚠️ WARNING: This will delete ALL users, conversations, and messages! ⚠️⚠️⚠️');
    const confirm1 = await this.question('Are you absolutely sure? Type "DELETE ALL" to confirm: ');

    if (confirm1 !== 'DELETE ALL') {
      console.log('❌ Deletion cancelled');
      return;
    }

    const confirm2 = await this.question('This action cannot be undone! Type "CONFIRM DELETE ALL" to proceed: ');

    if (confirm2 !== 'CONFIRM DELETE ALL') {
      console.log('❌ Deletion cancelled');
      return;
    }

    try {
      const [userCount, conversationCount, messageCount] = await Promise.all([
        User.countDocuments(),
        Conversation.countDocuments(),
        Message.countDocuments()
      ]);

      await Promise.all([
        User.deleteMany({}),
        Conversation.deleteMany({}),
        Message.deleteMany({})
      ]);

      console.log('✅ All data deleted successfully!');
      console.log(`📊 Deleted: ${userCount} users + ${conversationCount} conversations + ${messageCount} messages`);

      // Clear current selections
      this.currentUser = null;
      this.currentConversation = null;

    } catch (error) {
      console.error('❌ Error deleting all users:', error.message);
    }
  }

  async sendMessageToAI() {
    if (!this.currentUser) {
      console.log('❌ Please select a user first (option 9)');
      return;
    }

    if (!this.currentConversation) {
      console.log('❌ Please select a conversation first (option 3)');
      return;
    }

    const message = await this.question('Enter your message: ');
    
    // Enhanced configuration options
    console.log('\n⚙️ Configuration Options:');
    console.log('========================');
    
    const model = await this.question('Enter model (default: gemini-2.5-flash): ') || 'gemini-2.5-flash';
    const temperature = parseFloat(await this.question('Enter temperature 0.0-2.0 (default: 0.7): ') || '0.7');
    const maxTokens = parseInt(await this.question('Enter max output tokens (default: 2048): ') || '2048');
    
    const includeHistory = await this.question('Include conversation history? (y/n, default: y): ');
    const maxHistoryMessages = includeHistory.toLowerCase() !== 'n' ? 
      parseInt(await this.question('Max history messages (default: 20): ') || '20') : 0;
    
    // Thinking configuration
    console.log('\n🧠 Thinking Configuration:');
    const useThinking = await this.question('Enable AI thinking? (y/n, default: y): ');
    let thinkingBudget = -1;
    let includeThoughts = true;
    
    if (useThinking.toLowerCase() !== 'n') {
      const budgetChoice = await this.question('Thinking budget: (1) Dynamic (-1), (2) Off (0), (3) Custom tokens (default: 1): ') || '1';
      if (budgetChoice === '2') {
        thinkingBudget = 0;
      } else if (budgetChoice === '3') {
        thinkingBudget = parseInt(await this.question('Enter thinking token budget: '));
      }
      includeThoughts = (await this.question('Include thoughts in response? (y/n, default: y): ')).toLowerCase() !== 'n';
    } else {
      thinkingBudget = 0;
      includeThoughts = false;
    }

    try {
      console.log('\n🤖 Sending message to AI...');
      
      const requestBody = {
        userId: this.currentUser._id.toString(),
        conversationId: this.currentConversation.conversationId,
        contents: message,
        model,
        config: {
          temperature,
          maxOutputTokens: maxTokens,
          thinkingConfig: {
            thinkingBudget,
            includeThoughts
          },
          conversationHistory: {
            include: includeHistory.toLowerCase() !== 'n',
            maxMessages: maxHistoryMessages,
            includeThoughts: false
          }
        }
      };

      const response = await fetch('http://localhost:5000/api/ai/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();

      if (result.success) {
        console.log('\n✅ AI Response received successfully!');
        console.log('=====================================');
        console.log(`👤 User Message (${result.userMessage.messageSequence}): ${result.userMessage.content}`);
        console.log(`🤖 AI Response (${result.modelMessage.messageSequence}): ${result.modelMessage.content}`);
        
        if (result.thoughts && includeThoughts) {
          console.log(`🧠 AI Thoughts: ${result.thoughts}`);
        }
        
        console.log('\n📊 Response Metadata:');
        console.log(`🎯 Tokens Used: ${result.usageMetadata?.totalTokenCount || 0} (Input: ${result.usageMetadata?.promptTokenCount || 0}, Output: ${result.usageMetadata?.candidatesTokenCount || 0})`);
        console.log(`🌡️ Temperature: ${temperature}`);
        console.log(`🤖 Model: ${result.model}`);
        console.log(`🏢 Provider: ${result.provider}`);
        console.log(`📝 Conversation Stats: ${result.conversationStats.totalMessages} messages, ${result.conversationStats.totalTokens} total tokens`);
        
        if (result.hasThoughtSignatures) {
          console.log(`🧠 Has Thought Signatures: Yes`);
        }
      } else {
        console.log('❌ Error sending message:', result.error);
        if (result.details) {
          console.log('Details:', result.details);
        }
      }
    } catch (error) {
      console.error('❌ Error sending message to AI:', error.message);
    }
  }

  async editMessage() {
    if (!this.currentUser) {
      console.log('❌ Please select a user first (option 10)');
      return;
    }

    if (!this.currentConversation) {
      console.log('❌ Please select a conversation first (option 3)');
      return;
    }

    try {
      // Get user messages from the current conversation
      const userMessages = await Message.find({
        conversationId: this.currentConversation.conversationId,
        userId: this.currentUser._id.toString(),
        role: 'user',
        isVisible: true
      }).sort({ messageSequence: 1 });

      if (userMessages.length === 0) {
        console.log('📭 No user messages found in this conversation');
        return;
      }

      console.log('\n📝 Your Messages in this Conversation:');
      console.log('====================================');
      userMessages.forEach((msg, index) => {
        console.log(`${index + 1}. (Sequence: ${msg.messageSequence}) ${msg.content.text}`);
        console.log(`   🕒 Created: ${msg.createdAt?.toLocaleString()}`);
        console.log('');
      });

      const choice = await this.question(`Select a message to edit (1-${userMessages.length}): `);
      const msgIndex = parseInt(choice) - 1;

      if (msgIndex < 0 || msgIndex >= userMessages.length) {
        console.log('❌ Invalid selection');
        return;
      }

      const selectedMessage = userMessages[msgIndex];
      console.log(`\n📝 Current Message: ${selectedMessage.content.text}`);
      console.log(`⚠️  Warning: Editing this message will delete all messages after sequence ${selectedMessage.messageSequence}`);
      
      const newContent = await this.question('Enter new message content: ');
      if (!newContent.trim()) {
        console.log('❌ Message content cannot be empty');
        return;
      }

      // Enhanced configuration for the edited message
      console.log('\n⚙️ Configuration for AI Response:');
      const model = await this.question('Enter model (default: gemini-2.5-flash): ') || 'gemini-2.5-flash';
      const temperature = parseFloat(await this.question('Enter temperature 0.0-2.0 (default: 0.7): ') || '0.7');
      const maxTokens = parseInt(await this.question('Enter max output tokens (default: 2048): ') || '2048');
      
      const useThinking = await this.question('Enable AI thinking? (y/n, default: y): ');
      let thinkingBudget = -1;
      let includeThoughts = true;
      
      if (useThinking.toLowerCase() !== 'n') {
        const budgetChoice = await this.question('Thinking budget: (1) Dynamic (-1), (2) Off (0), (3) Custom tokens (default: 1): ') || '1';
        if (budgetChoice === '2') {
          thinkingBudget = 0;
        } else if (budgetChoice === '3') {
          thinkingBudget = parseInt(await this.question('Enter thinking token budget: '));
        }
        includeThoughts = (await this.question('Include thoughts in response? (y/n, default: y): ')).toLowerCase() !== 'n';
      } else {
        thinkingBudget = 0;
        includeThoughts = false;
      }

      console.log('\n🔄 Processing message edit...');

      const response = await fetch('http://localhost:5000/api/ai/edit-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: this.currentUser._id.toString(),
          conversationId: this.currentConversation.conversationId,
          messageId: selectedMessage.messageId,
          newContent,
          model,
          config: {
            temperature,
            maxOutputTokens: maxTokens,
            thinkingConfig: {
              thinkingBudget,
              includeThoughts
            }
          }
        })
      });

      const result = await response.json();

      if (result.success) {
        console.log('\n✅ Message edited and AI response generated!');
        console.log('============================================');
        console.log(`📝 Edited Message (${result.editedMessage.messageSequence}): ${result.editedMessage.content}`);
        console.log(`🤖 New AI Response (${result.newResponse.messageSequence}): ${result.newResponse.content}`);
        
        if (result.thoughts && includeThoughts) {
          console.log(`🧠 AI Thoughts: ${result.thoughts}`);
        }
        
        console.log(`🗑️ Deleted ${result.deletedCount} subsequent messages`);
        console.log('\n📊 Response Metadata:');
        console.log(`🎯 Tokens Used: ${result.usageMetadata?.totalTokenCount || 0} (Input: ${result.usageMetadata?.promptTokenCount || 0}, Output: ${result.usageMetadata?.candidatesTokenCount || 0})`);
        console.log(`🌡️ Temperature: ${temperature}`);
        console.log(`🤖 Model: ${result.model}`);
        console.log(`🏢 Provider: ${result.provider}`);
      } else {
        console.log('❌ Error editing message:', result.error);
        if (result.details) {
          console.log('Details:', result.details);
        }
      }
    } catch (error) {
      console.error('❌ Error editing message:', error.message);
    }
  }

  async callPlugin() {
    if (!this.currentUser) {
      console.log('❌ Please select a user first (option 10)');
      return;
    }

    if (!this.currentConversation) {
      console.log('❌ Please select a conversation first (option 3)');
      return;
    }

    console.log('\n🔧 Available Plugins:');
    console.log('=====================');
    console.log('1. Calculator (add, subtract, multiply, divide)');
    console.log('2. Echo (echoes back a message)');
    console.log('');

    const pluginChoice = await this.question('Choose plugin (1-2): ');
    let pluginName, parameters;

    if (pluginChoice === '1') {
      pluginName = 'calculator';
      const operation = await this.question('Enter operation (add/subtract/multiply/divide): ');
      const number1 = parseFloat(await this.question('Enter first number: '));
      const number2 = parseFloat(await this.question('Enter second number: '));
      
      parameters = { operation, number1, number2 };
    } else if (pluginChoice === '2') {
      pluginName = 'echo';
      const message = await this.question('Enter message to echo: ');
      
      parameters = { message };
    } else {
      console.log('❌ Invalid plugin choice');
      return;
    }

    const sendToModel = await this.question('Send result to AI model? (y/n, default: y): ');
    
    let modelConfig = null;
    if (sendToModel.toLowerCase() !== 'n') {
      console.log('\n⚙️ AI Model Configuration:');
      console.log('==========================');
      
      const model = await this.question('Enter model (default: gemini-2.5-flash): ') || 'gemini-2.5-flash';
      const provider = await this.question('Enter provider (default: google): ') || 'google';
      const temperature = parseFloat(await this.question('Enter temperature 0.0-2.0 (default: 0.7): ') || '0.7');
      const maxTokens = parseInt(await this.question('Enter max output tokens (default: 2048): ') || '2048');
      
      const includeHistory = await this.question('Include conversation history? (y/n, default: y): ');
      const maxHistoryMessages = includeHistory.toLowerCase() !== 'n' ? 
        parseInt(await this.question('Max history messages (default: 10): ') || '10') : 0;
      
      // Thinking configuration
      console.log('\n🧠 Thinking Configuration:');
      const useThinking = await this.question('Enable AI thinking? (y/n, default: y): ');
      let thinkingBudget = -1;
      let includeThoughts = true;
      
      if (useThinking.toLowerCase() !== 'n') {
        const budgetChoice = await this.question('Thinking budget: (1) Dynamic (-1), (2) Off (0), (3) Custom tokens (default: 1): ') || '1';
        if (budgetChoice === '2') {
          thinkingBudget = 0;
        } else if (budgetChoice === '3') {
          thinkingBudget = parseInt(await this.question('Enter thinking token budget: '));
        }
        includeThoughts = (await this.question('Include thoughts in response? (y/n, default: y): ')).toLowerCase() !== 'n';
      } else {
        thinkingBudget = 0;
        includeThoughts = false;
      }

      modelConfig = {
        model,
        provider,
        temperature,
        maxOutputTokens: maxTokens,
        includeConversationHistory: includeHistory.toLowerCase() !== 'n',
        maxHistoryMessages,
        thinkingConfig: {
          thinkingBudget,
          includeThoughts
        }
      };
    }

    try {
      console.log(`\n🔧 Executing ${pluginName} plugin...`);
      
      const requestBody = {
        userId: this.currentUser._id.toString(),
        conversationId: this.currentConversation.conversationId,
        parameters,
        sendToModel: sendToModel.toLowerCase() !== 'n'
      };

      if (modelConfig) {
        requestBody.modelConfig = modelConfig;
      }

      const response = await fetch(`http://localhost:5000/api/plugins/google/${pluginName}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();

      if (result.success) {
        console.log('\n✅ Plugin executed successfully!');
        console.log('=================================');
        console.log(`🔧 Plugin: ${result.plugin}`);
        console.log(`🏢 Provider: ${result.provider}`);
        console.log(`📝 Result: ${JSON.stringify(result.result, null, 2)}`);
        console.log(`📨 Message ID: ${result.messageId} (Sequence: ${result.messageSequence})`);
        
        if (result.aiResponse && !result.aiResponse.error) {
          console.log('\n🤖 AI Analysis:');
          console.log('===============');
          console.log(`📝 Response (${result.aiResponse.messageSequence}): ${result.aiResponse.content}`);
          
          if (result.aiResponse.thoughts) {
            console.log(`🧠 AI Thoughts: ${result.aiResponse.thoughts}`);
          }
          
          console.log('\n📊 AI Response Metadata:');
          console.log(`🎯 Tokens Used: ${result.aiResponse.tokenUsage?.totalTokenCount || 0} (Input: ${result.aiResponse.tokenUsage?.promptTokenCount || 0}, Output: ${result.aiResponse.tokenUsage?.candidatesTokenCount || 0})`);
          console.log(`🌡️ Temperature: ${modelConfig?.temperature || 'N/A'}`);
          console.log(`🤖 Model: ${modelConfig?.model || 'N/A'}`);
          console.log(`🏢 Provider: ${modelConfig?.provider || 'N/A'}`);
        } else if (result.aiResponse?.error) {
          console.log(`❌ AI Response Error: ${result.aiResponse.error}`);
        }
      } else {
        console.log('❌ Error executing plugin:', result.error);
        if (result.details) {
          console.log('Details:', result.details);
        }
      }
    } catch (error) {
      console.error('❌ Error calling plugin:', error.message);
    }
  }

  async showDatabaseStatistics() {
    try {
      const [userCount, conversationCount, messageCount] = await Promise.all([
        User.countDocuments(),
        Conversation.countDocuments(),
        Message.countDocuments()
      ]);

      const recentConversations = await Conversation.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      });

      const recentMessages = await Message.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      });

      const tokenUsage = await Message.aggregate([
        { $match: { 'metadata.tokens.total': { $exists: true } } },
        { $group: { _id: null, totalTokens: { $sum: '$metadata.tokens.total' } } }
      ]);

      console.log('\n📊 Database Statistics:');
      console.log('=======================');
      console.log(`👥 Total Users: ${userCount}`);
      console.log(`💬 Total Conversations: ${conversationCount}`);
      console.log(`📝 Total Messages: ${messageCount}`);
      console.log(`🆕 New Conversations (24h): ${recentConversations}`);
      console.log(`🆕 New Messages (24h): ${recentMessages}`);
      console.log(`🎯 Total Tokens Used: ${tokenUsage[0]?.totalTokens || 0}`);
      console.log('');

      // Show model usage
      const modelUsage = await Message.aggregate([
        { $match: { 'metadata.provider.model': { $exists: true } } },
        { $group: { _id: '$metadata.provider.model', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);

      if (modelUsage.length > 0) {
        console.log('🤖 Model Usage:');
        modelUsage.forEach(model => {
          console.log(`   ${model._id}: ${model.count} messages`);
        });
        console.log('');
      }

    } catch (error) {
      console.error('❌ Error getting database statistics:', error.message);
    }
  }

  async selectUserAtStartup() {
    try {
      const users = await User.find({}).sort({ createdAt: -1 }).limit(20);
      
      if (users.length === 0) {
        console.log('📭 No users found in the database.');
        console.log('💡 You can create a new user from the main menu (option 7).');
        return;
      }

      console.log('\n👥 Available Users:');
      console.log('==================');
      users.forEach((user, index) => {
        console.log(`${index + 1}. ${user.fullName} (${user.email})`);
        console.log(`   🔑 Role: ${user.role} | 📦 Plan: ${user.subscriptionPlan}`);
        console.log(`   🕒 Created: ${user.createdAt?.toLocaleDateString()}`);
        console.log('');
      });

      console.log(`${users.length + 1}. Skip user selection (continue without user)`);
      console.log('');

      const choice = await this.question(`Select a user (1-${users.length + 1}): `);
      const userIndex = parseInt(choice) - 1;

      if (userIndex >= 0 && userIndex < users.length) {
        this.currentUser = users[userIndex];
        console.log(`✅ Selected user: ${this.currentUser.fullName} (${this.currentUser.email})`);
        
        // Auto-load recent conversations for the selected user
        const recentConversations = await Conversation
          .find({ userId: this.currentUser._id.toString() })
          .sort({ updatedAt: -1 })
          .limit(5);

        if (recentConversations.length > 0) {
          console.log('\n💬 Recent Conversations:');
          recentConversations.forEach((conv, index) => {
            console.log(`   ${index + 1}. ${conv.title} (${conv.stats?.totalMessages || 0} messages)`);
          });
          console.log('');
        }
      } else if (userIndex === users.length) {
        console.log('⏭️ Skipping user selection. You can select a user later from the menu.');
      } else {
        console.log('❌ Invalid selection. Continuing without user selection.');
      }
    } catch (error) {
      console.error('❌ Error during user selection:', error.message);
    }
  }

  async run() {
    console.log('🚀 Starting Apsara Conversation Manager...');
    await this.connect();

    // Select user at startup
    await this.selectUserAtStartup();

    while (true) {
      try {
        const choice = await this.showMainMenu();

        switch (choice) {
          case '1':
            await this.createConversation();
            break;
          case '2':
            await this.listConversations();
            break;
          case '3':
            await this.chooseConversation();
            break;
          case '4':
            await this.viewConversationMessages();
            break;
          case '5':
            await this.sendMessageToAI();
            break;
          case '6':
            await this.editMessage();
            break;
          case '7':
            await this.callPlugin();
            break;
          case '8':
            await this.createUser();
            break;
          case '9':
            await this.listUsers();
            break;
          case '10':
            await this.chooseUser();
            break;
          case '11':
            await this.deleteUser();
            break;
          case '12':
            await this.deleteAllUsers();
            break;
          case '13':
            await this.showDatabaseStatistics();
            break;
          case '14':
            console.log('👋 Goodbye!');
            await this.disconnect();
            rl.close();
            process.exit(0);
            break;
          default:
            console.log('❌ Invalid choice. Please select 1-14.');
        }

        // Wait for user to press enter before showing menu again
        await this.question('\nPress Enter to continue...');
      } catch (error) {
        console.error('❌ An error occurred:', error.message);
        await this.question('\nPress Enter to continue...');
      }
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down gracefully...');
  await mongoose.disconnect();
  rl.close();
  process.exit(0);
});

// Run the manager
const manager = new ConversationManager();
manager.run().catch(console.error); 