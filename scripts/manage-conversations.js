#!/usr/bin/env node

import mongoose from 'mongoose';
import readline from 'readline';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fetch from 'node-fetch';
import { FormData, File } from 'formdata-node';

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
    console.log('13. Delete all conversations');
    console.log('14. Delete specific conversation');
    console.log('15. Full user registration (with OTP)');
    console.log('16. Logout current user');
    console.log('17. Database statistics');
    console.log('18. User-specific statistics');
    console.log('19. Upload file and analyze with AI');
    console.log('20. Regenerate AI response');
    console.log('21. Exit');
    console.log('================================');
    
    if (this.currentUser) {
      console.log(`👤 Current User: ${this.currentUser.fullName} (${this.currentUser.email})`);
    }
    if (this.currentConversation) {
      console.log(`💬 Current Conversation: ${this.currentConversation.title}`);
    }
    console.log('');

    const choice = await this.question('Enter your choice (1-21): ');
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

  async deleteAllConversations() {
    console.log('⚠️⚠️⚠️ WARNING: This will delete ALL conversations and messages from ALL users! ⚠️⚠️⚠️');
    const confirm1 = await this.question('Are you absolutely sure? Type "DELETE ALL CONVERSATIONS" to confirm: ');

    if (confirm1 !== 'DELETE ALL CONVERSATIONS') {
      console.log('❌ Deletion cancelled');
      return;
    }

    const confirm2 = await this.question('This action cannot be undone! Type "CONFIRM DELETE CONVERSATIONS" to proceed: ');

    if (confirm2 !== 'CONFIRM DELETE CONVERSATIONS') {
      console.log('❌ Deletion cancelled');
      return;
    }

    try {
      const [conversationCount, messageCount] = await Promise.all([
        Conversation.countDocuments(),
        Message.countDocuments()
      ]);

      await Promise.all([
        Conversation.deleteMany({}),
        Message.deleteMany({})
      ]);

      console.log('✅ All conversations deleted successfully!');
      console.log(`📊 Deleted: ${conversationCount} conversations + ${messageCount} messages`);

      // Clear current conversation selection
      this.currentConversation = null;

    } catch (error) {
      console.error('❌ Error deleting all conversations:', error.message);
    }
  }

  async deleteSpecificConversation() {
    if (!this.currentUser) {
      console.log('❌ Please select a user first (option 10)');
      return;
    }

    try {
      const conversations = await Conversation
        .find({ userId: this.currentUser._id.toString() })
        .sort({ updatedAt: -1 })
        .limit(20);

      if (conversations.length === 0) {
        console.log('📭 No conversations found for this user');
        return;
      }

      console.log('\n💬 User Conversations:');
      console.log('=====================');
      conversations.forEach((conv, index) => {
        console.log(`${index + 1}. ${conv.title}`);
        console.log(`   🆔 ID: ${conv.conversationId}`);
        console.log(`   📊 Status: ${conv.status} | 💬 Messages: ${conv.stats?.totalMessages || 0}`);
        console.log(`   🕒 Updated: ${conv.updatedAt?.toLocaleString()}`);
        console.log('');
      });

      const choice = await this.question(`Select a conversation to delete (1-${conversations.length}): `);
      const convIndex = parseInt(choice) - 1;

      if (convIndex < 0 || convIndex >= conversations.length) {
        console.log('❌ Invalid selection');
        return;
      }

      const selectedConversation = conversations[convIndex];
      console.log(`⚠️ You are about to delete conversation: "${selectedConversation.title}"`);
      console.log(`📊 This will delete ${selectedConversation.stats?.totalMessages || 0} messages`);
      
      const confirm = await this.question('Are you sure? Type "DELETE" to confirm: ');

      if (confirm !== 'DELETE') {
        console.log('❌ Deletion cancelled');
        return;
      }

      // Count messages before deletion
      const messageCount = await Message.countDocuments({ 
        conversationId: selectedConversation.conversationId 
      });

      // Delete conversation and all its messages
      await Promise.all([
        Conversation.deleteOne({ _id: selectedConversation._id }),
        Message.deleteMany({ conversationId: selectedConversation.conversationId })
      ]);

      console.log('✅ Conversation deleted successfully!');
      console.log(`📊 Deleted: 1 conversation + ${messageCount} messages`);

      // Clear current conversation if it was the deleted one
      if (this.currentConversation && this.currentConversation.conversationId === selectedConversation.conversationId) {
        this.currentConversation = null;
        console.log('⚠️ Current conversation was deleted. Please select a new conversation.');
      }

    } catch (error) {
      console.error('❌ Error deleting conversation:', error.message);
    }
  }

  async fullUserRegistration() {
    console.log('\n🔐 Full User Registration & Authentication System');
    console.log('=================================================');
    console.log('1. Register new user (with OTP verification)');
    console.log('2. Login existing user');
    console.log('3. Login with Google OAuth');
    console.log('4. Guest login (5 messages limit)');
    console.log('5. Forgot password (OTP reset)');
    console.log('6. Back to main menu');
    console.log('');

    const choice = await this.question('Choose an option (1-6): ');

    switch (choice) {
      case '1':
        await this.registerUserWithOTP();
        break;
      case '2':
        await this.loginUser();
        break;
      case '3':
        await this.loginWithGoogle();
        break;
      case '4':
        await this.guestLogin();
        break;
      case '5':
        await this.forgotPassword();
        break;
      case '6':
        console.log('🔙 Returning to main menu...');
        return;
      default:
        console.log('❌ Invalid choice. Please select 1-6.');
    }
  }

  async registerUserWithOTP() {
    try {
      console.log('\n📝 User Registration');
      console.log('====================');
      
      const fullName = await this.question('Enter full name: ');
      const email = await this.question('Enter email: ');
      const password = await this.question('Enter password: ');
      const confirmPassword = await this.question('Confirm password: ');

      if (password !== confirmPassword) {
        console.log('❌ Passwords do not match');
        return;
      }

      console.log('📧 Sending registration request...');

      const response = await fetch('http://localhost:5000/api/users/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fullName,
          email,
          password,
          acceptTerms: true
        })
      });

      const result = await response.json();

      if (result.success) {
        console.log('✅ Registration successful!');
        console.log(`📧 OTP sent to: ${email}`);
        console.log('💡 Please check your email for the verification code');

        const otp = await this.question('Enter OTP code: ');

        console.log('🔍 Verifying OTP...');

        const verifyResponse = await fetch('http://localhost:5000/api/users/verify-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email,
            otp
          })
        });

        const verifyResult = await verifyResponse.json();

        if (verifyResult.success) {
          console.log('✅ Email verified successfully!');
          console.log('🎉 User account is now active');
          
          // Find and set the newly created user
          const user = await User.findOne({ email: email.toLowerCase() });
          if (user) {
            this.currentUser = user;
            console.log(`👤 Automatically selected user: ${user.fullName}`);
          }
        } else {
          console.log('❌ OTP verification failed:', verifyResult.error);
        }
      } else {
        console.log('❌ Registration failed:', result.error);
        if (result.details) {
          console.log('Details:', result.details);
        }
      }
    } catch (error) {
      console.error('❌ Error during registration:', error.message);
    }
  }

  async loginUser() {
    // Check if user is already logged in
    if (this.currentUser) {
      console.log(`⚠️ User already logged in: ${this.currentUser.fullName} (${this.currentUser.email})`);
      console.log('💡 Please logout first using option 16 before logging in as a different user');
      return;
    }

    try {
      console.log('\n🔑 User Login');
      console.log('=============');
      
      const email = await this.question('Enter email: ');
      const password = await this.question('Enter password: ');

      console.log('🔍 Authenticating...');

      const response = await fetch('http://localhost:5000/api/users/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password
        })
      });

      const result = await response.json();

      if (result.success) {
        console.log('✅ Login successful!');
        
        // Find and set the logged in user from database
        const user = await User.findOne({ email: email.toLowerCase() });
        if (user) {
          this.currentUser = user;
          console.log(`👤 Welcome back, ${user.fullName}!`);
          console.log(`🔑 Role: ${user.role}`);
          console.log(`📦 Plan: ${user.subscriptionPlan}`);
          console.log(`👤 User selected: ${user.fullName}`);
          
          // Auto-load recent conversations
          const recentConversations = await Conversation
            .find({ userId: user._id.toString() })
            .sort({ updatedAt: -1 })
            .limit(5);

          if (recentConversations.length > 0) {
            console.log('\n💬 Recent Conversations:');
            recentConversations.forEach((conv, index) => {
              console.log(`   ${index + 1}. ${conv.title} (${conv.stats?.totalMessages || 0} messages)`);
            });
            console.log('');
          }
        } else {
          console.log('❌ Error: User found in API but not in local database');
        }
      } else {
        console.log('❌ Login failed:', result.error);
      }
    } catch (error) {
      console.error('❌ Error during login:', error.message);
    }
  }

  async loginWithGoogle() {
    try {
      console.log('\n🌟 Google OAuth Login');
      console.log('====================');
      console.log('💡 Note: This is a simulation of Google OAuth login');
      console.log('🔧 In production, this would open a browser for Google authentication');
      console.log('');
      
      const email = await this.question('Enter your Google email: ');
      const name = await this.question('Enter your full name: ');
      
      console.log('🔍 Authenticating with Google...');

      const response = await fetch('http://localhost:5000/api/users/google-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          idToken: 'mock_google_token_' + Math.random().toString(36).substr(2, 9),
          email,
          name,
          picture: null // Optional profile picture
        })
      });

      const result = await response.json();

      if (result.success) {
        console.log('✅ Google authentication successful!');
        
        // Find and set the logged in user from database
        const user = await User.findOne({ email: email.toLowerCase() });
        if (user) {
          this.currentUser = user;
          console.log(`👤 Welcome, ${user.fullName}!`);
          console.log(`🔑 Role: ${user.role}`);
          console.log(`📦 Plan: ${user.subscriptionPlan}`);
          console.log(`🔐 Auth Provider: ${user.authProvider}`);
          console.log(`👤 User selected: ${user.fullName}`);
          
          // Auto-load recent conversations
          const recentConversations = await Conversation
            .find({ userId: user._id.toString() })
            .sort({ updatedAt: -1 })
            .limit(5);

          if (recentConversations.length > 0) {
            console.log('\n💬 Recent Conversations:');
            recentConversations.forEach((conv, index) => {
              console.log(`   ${index + 1}. ${conv.title} (${conv.stats?.totalMessages || 0} messages)`);
            });
            console.log('');
          }

          // Show usage information
          if (result.data.usageInfo) {
            console.log('📊 Usage Information:');
            console.log(`   Daily Usage: ${JSON.stringify(result.data.usageInfo.dailyUsage)}`);
            console.log(`   Total Messages: ${result.data.usageInfo.totalUsage?.totalMessages || 0}`);
            console.log('');
          }
        } else {
          console.log('❌ Error: User found in API but not in local database');
        }
      } else {
        console.log('❌ Google authentication failed:', result.message);
      }
    } catch (error) {
      console.error('❌ Error during Google authentication:', error.message);
      console.log('💡 Note: Google OAuth endpoints require proper setup');
    }
  }

  async guestLogin() {
    try {
      console.log('\n🚀 Guest Login');
      console.log('==============');
      console.log('ℹ️  Guest users get 5 messages total');
      console.log('ℹ️  Access to gemini-2.5-flash model only');
      console.log('ℹ️  Session expires in 24 hours');
      console.log('');

      const useExistingSession = await this.question('Do you have an existing guest session ID? (y/n): ');
      let sessionId = null;

      if (useExistingSession.toLowerCase() === 'y') {
        sessionId = await this.question('Enter your guest session ID: ');
      }

      console.log('🔄 Creating guest session...');

      const response = await fetch('http://localhost:5000/api/users/guest-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: sessionId || undefined
        })
      });

      const result = await response.json();

      if (result.success) {
        console.log('✅ Guest session created successfully!');
        
        // Find and set the guest user from database
        const user = await User.findById(result.data.user.id);
        if (user) {
          this.currentUser = user;
          console.log(`👤 Welcome, ${user.fullName}!`);
          console.log(`🔑 Role: ${user.role}`);
          console.log(`📦 Plan: ${user.subscriptionPlan}`);
          console.log(`🆔 Session ID: ${result.data.user.sessionId}`);
          console.log(`👤 User selected: ${user.fullName}`);
          console.log('');
          
          // Show guest limitations
          console.log('🎯 Guest Limitations:');
          console.log(`   Total Messages Limit: ${result.data.limitations.totalMessagesLimit}`);
          console.log(`   Messages Used: ${result.data.limitations.totalMessagesUsed}`);
          console.log(`   Messages Remaining: ${result.data.limitations.remainingMessages}`);
          console.log(`   Available Models: ${result.data.limitations.availableModels.join(', ')}`);
          console.log(`   Session Duration: ${result.data.limitations.sessionDuration}`);
          console.log('');
          
          if (result.data.limitations.remainingMessages === 0) {
            console.log('⚠️  You have used all your guest messages!');
            console.log('💡 Consider registering for a free account to continue using Apsara');
          }
        } else {
          console.log('❌ Error: Guest user found in API but not in local database');
        }
      } else {
        console.log('❌ Guest login failed:', result.message);
      }
    } catch (error) {
      console.error('❌ Error during guest login:', error.message);
    }
  }

  async forgotPassword() {
    try {
      console.log('\n🔑 Password Reset');
      console.log('=================');
      
      const email = await this.question('Enter your email address: ');

      console.log('📧 Sending password reset request...');

      // Note: This endpoint might not exist yet in the actual API
      // For now, we'll simulate the process with mock responses
      try {
        const response = await fetch('http://localhost:5000/api/users/forgot-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email
          })
        });

        const result = await response.json();

        if (result.success) {
          console.log('✅ Password reset email sent!');
          console.log(`📧 Please check your email: ${email}`);
          
          // Step 1: Verify OTP first
          const otp = await this.question('Enter OTP from email: ');
          
          console.log('🔍 Verifying OTP...');

          const verifyResponse = await fetch('http://localhost:5000/api/users/verify-reset-otp', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              email,
              otp
            })
          });

          const verifyResult = await verifyResponse.json();

          if (verifyResult.success) {
            console.log('✅ OTP verified successfully!');
            
            // Step 2: Now ask for new password
            console.log('\n🔐 Set New Password');
            console.log('==================');
            const newPassword = await this.question('Enter new password: ');
            const confirmPassword = await this.question('Confirm new password: ');

            if (newPassword !== confirmPassword) {
              console.log('❌ Passwords do not match');
              return;
            }

            console.log('🔄 Updating password...');

            const resetResponse = await fetch('http://localhost:5000/api/users/reset-password-otp', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                email,
                otp,
                newPassword
              })
            });

            const resetResult = await resetResponse.json();

            if (resetResult.success) {
              console.log('✅ Password updated successfully!');
              console.log('🔑 You can now login with your new password');
            } else {
              console.log('❌ Password update failed:', resetResult.error || 'Unknown error');
            }
          } else {
            console.log('❌ OTP verification failed:', verifyResult.error || 'Invalid OTP');
          }
        } else {
          console.log('❌ Failed to send reset email:', result.error || 'Unknown error');
        }
      } catch (fetchError) {
        // If API endpoints don't exist, provide a helpful message
        console.log('❌ Password reset service unavailable');
        console.log('💡 Note: Password reset endpoints are not yet implemented in the API');
        console.log('🔧 This feature will be available once the backend endpoints are added');
        console.log('');
        console.log('📝 Required endpoints:');
        console.log('   - POST /api/users/forgot-password');
        console.log('   - POST /api/users/verify-reset-otp');
        console.log('   - POST /api/users/reset-password');
      }
    } catch (error) {
      console.error('❌ Error during password reset:', error.message);
      console.log('💡 Note: Password reset functionality requires additional API endpoints');
    }
  }

  async logoutUser() {
    if (!this.currentUser) {
      console.log('❌ No user is currently logged in');
      return;
    }

    console.log(`🔓 Logging out user: ${this.currentUser.fullName} (${this.currentUser.email})`);
    
    // Clear current user and conversation
    this.currentUser = null;
    this.currentConversation = null;
    
    console.log('✅ User logged out successfully!');
    console.log('💡 You can select a new user from the startup menu or login via full registration system');
  }

  async showUserSpecificStatistics() {
    if (!this.currentUser) {
      console.log('❌ Please login first to view user-specific statistics');
      console.log('💡 Use option 15 (Full user registration) to login');
      return;
    }

    try {
      // Verify user credentials for security
      console.log('\n🔐 Verify Identity for Statistics Access');
      console.log('======================================');
      const email = await this.question('Enter your email: ');
      const password = await this.question('Enter your password: ');

      if (email.toLowerCase() !== this.currentUser.email.toLowerCase()) {
        console.log('❌ Email does not match current logged-in user');
        return;
      }

      // Verify password via API
      const loginResponse = await fetch('http://localhost:5000/api/users/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password
        })
      });

      const loginResult = await loginResponse.json();
      
      if (!loginResult.success) {
        console.log('❌ Password verification failed');
        return;
      }

      // Get user-specific statistics
      const userId = this.currentUser._id.toString();

      const [
        userConversationCount,
        userMessageCount,
        recentConversations,
        recentMessages,
        modelUsage,
        tokenUsage
      ] = await Promise.all([
        Conversation.countDocuments({ userId }),
        Message.countDocuments({ userId }),
        Conversation.countDocuments({
          userId,
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }),
        Message.countDocuments({
          userId,
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }),
        Message.aggregate([
          { $match: { userId, 'metadata.provider.model': { $exists: true } } },
          { $group: { _id: '$metadata.provider.model', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]),
        Message.aggregate([
          { $match: { userId, 'metadata.tokens.total': { $exists: true } } },
          { $group: { _id: null, totalTokens: { $sum: '$metadata.tokens.total' } } }
        ])
      ]);

      console.log('\n📊 Your Personal Statistics:');
      console.log('============================');
      console.log(`👤 User: ${this.currentUser.fullName} (${this.currentUser.email})`);
      console.log(`🔑 Role: ${this.currentUser.role}`);
      console.log(`📦 Plan: ${this.currentUser.subscriptionPlan}`);
      console.log(`📅 Member Since: ${this.currentUser.createdAt?.toLocaleDateString()}`);
      console.log('');
      
      console.log('💬 Conversation Statistics:');
      console.log(`   Total Conversations: ${userConversationCount}`);
      console.log(`   New Conversations (24h): ${recentConversations}`);
      console.log('');
      
      console.log('📝 Message Statistics:');
      console.log(`   Total Messages: ${userMessageCount}`);
      console.log(`   New Messages (24h): ${recentMessages}`);
      console.log('');
      
      console.log('🎯 Token Usage:');
      console.log(`   Total Tokens Used: ${tokenUsage[0]?.totalTokens || 0}`);
      console.log('');

      if (modelUsage.length > 0) {
        console.log('🤖 Your Model Usage:');
        modelUsage.forEach(model => {
          console.log(`   ${model._id}: ${model.count} messages`);
        });
        console.log('');
      }

      // Get most active conversations
      const activeConversations = await Conversation
        .find({ userId })
        .sort({ 'stats.totalMessages': -1 })
        .limit(5)
        .select('title stats.totalMessages stats.totalTokens updatedAt');

      if (activeConversations.length > 0) {
        console.log('🔥 Most Active Conversations:');
        activeConversations.forEach((conv, index) => {
          console.log(`   ${index + 1}. ${conv.title}`);
          console.log(`      Messages: ${conv.stats?.totalMessages || 0}, Tokens: ${conv.stats?.totalTokens || 0}`);
          console.log(`      Last Activity: ${conv.updatedAt?.toLocaleDateString()}`);
        });
        console.log('');
      }

      // Get recent message distribution
      const messageTypes = await Message.aggregate([
        { $match: { userId } },
        { $group: { _id: '$role', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);

      if (messageTypes.length > 0) {
        console.log('📊 Message Distribution:');
        messageTypes.forEach(type => {
          console.log(`   ${type._id}: ${type.count} messages`);
        });
        console.log('');
      }

    } catch (error) {
      console.error('❌ Error getting user statistics:', error.message);
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
    
    // Conversation history is always included automatically
    
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
          // Conversation history is automatically included
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

    const runAsync = await this.question('Run plugin asynchronously? (y/n, default: n): ');
    const sendToModel = await this.question('Send result to AI model? (y/n, default: y): ');

    try {
      console.log(`\n🔧 Executing ${pluginName} plugin...`);
      
      const requestBody = {
        userId: this.currentUser._id.toString(),
        conversationId: this.currentConversation.conversationId,
        parameters,
        runAsync: runAsync.toLowerCase() === 'y',
        sendToModel: sendToModel.toLowerCase() !== 'n'
      };

      // Only add modelConfig if sending to model (with defaults)
      if (sendToModel.toLowerCase() !== 'n') {
        requestBody.modelConfig = {
          model: 'gemini-2.5-flash',
          provider: 'google',
          temperature: 0.7,
          maxOutputTokens: 2048,
          includeConversationHistory: true,
          maxHistoryMessages: 20,
          thinkingConfig: {
            thinkingBudget: -1,
            includeThoughts: true
          }
        };
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
        if (result.runAsync) {
          console.log('\n⏳ Plugin started asynchronously!');
          console.log('==================================');
          console.log(`🔧 Plugin: ${result.plugin}`);
          console.log(`🏢 Provider: ${result.provider}`);
          console.log(`🆔 Task ID: ${result.taskId}`);
          console.log(`📊 Status: ${result.status}`);
          console.log(`💬 Message: ${result.message}`);
          console.log('\n💡 Use the response endpoint to check results later.');
        } else {
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
            console.log(`🌡️ Temperature: 0.7`);
            console.log(`🤖 Model: gemini-2.5-flash`);
            console.log(`🏢 Provider: google`);
          } else if (result.aiResponse?.error) {
            console.log(`❌ AI Response Error: ${result.aiResponse.error}`);
          }
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

  async uploadFileAndAnalyze() {
    if (!this.currentUser) {
      console.log('❌ Please select a user first (option 10)');
      return;
    }

    if (!this.currentConversation) {
      console.log('❌ Please select a conversation first (option 3)');
      console.log('💡 You can create a new conversation (option 1)');
      return;
    }

    try {
      console.log('\n📁 File Upload & AI Analysis');
      console.log('=============================');
      
      const filePath = await this.question('Enter file path (e.g., ./image.jpg, /path/to/document.pdf): ');
      
      // Validate file path input
      if (!filePath || filePath.trim() === '') {
        console.log('❌ No file path provided');
        return;
      }
      
      const cleanFilePath = filePath.trim();
      console.log(`🔍 Checking file: ${cleanFilePath}`);
      
      // Check if file exists and validate size
      try {
        const stats = await import('fs').then(fs => fs.promises.stat(cleanFilePath));
        if (!stats.isFile()) {
          console.log('❌ Path exists but is not a file (might be a directory)');
          return;
        }
        
        // Display file information and check size limits
        const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
        const fileSizeBytes = stats.size;
        const maxSizeBytes = parseInt(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024;
        const maxSizeMB = Math.round(maxSizeBytes / 1024 / 1024);
        
        const path = await import('path');
        const fileName = path.basename(cleanFilePath);
        
        console.log(`\n📊 File Information:`);
        console.log(`📄 Name: ${fileName}`);
        console.log(`📏 Size: ${fileSizeMB} MB (${fileSizeBytes.toLocaleString()} bytes)`);
        console.log(`📋 Server limit: ${maxSizeMB} MB (${maxSizeBytes.toLocaleString()} bytes)`);
        
        if (fileSizeBytes > maxSizeBytes) {
          console.log(`❌ File is too large!`);
          console.log(`   Your file: ${fileSizeMB} MB`);
          console.log(`   Maximum allowed: ${maxSizeMB} MB`);
          console.log(`💡 Solutions:`);
          console.log(`   • Compress the file (use tools like 7zip, WinRAR)`);
          console.log(`   • For images: reduce resolution/quality`);
          console.log(`   • For PDFs: use PDF compressor tools`);
          console.log(`   • For videos: reduce resolution or use a shorter clip`);
          console.log(`   • Or ask admin to increase MAX_FILE_SIZE in .env`);
          return;
        } else {
          const percentUsed = ((fileSizeBytes / maxSizeBytes) * 100).toFixed(1);
          console.log(`✅ File size is within limits (using ${percentUsed}% of allowed size)`);
        }
        
      } catch (error) {
        console.log('❌ File not found or cannot be accessed');
        console.log(`📝 Error: ${error.message}`);
        
        if (error.code === 'ENOENT') {
          console.log('💡 File does not exist. Please check:');
          console.log('   • The file path is correct');
          console.log('   • The file name is spelled correctly');
          console.log('   • You have the right file extension');
          console.log('   • The file is in the expected location');
        } else if (error.code === 'EACCES') {
          console.log('💡 Permission denied. Please check:');
          console.log('   • You have read permissions for the file');
          console.log('   • The file is not locked by another program');
        }
        return;
      }

      console.log('\n📦 Storage Method:');
      console.log('==================');
      console.log('1. Local Storage (permanent, stored on server)');
      console.log('2. Google File API (48h expiry, optimized for AI processing)');
      console.log('');

      const storageChoice = await this.question('Choose storage method (1-2): ');
      let storageMethod;

      switch (storageChoice) {
        case '1':
          storageMethod = 'local';
          break;
        case '2':
          storageMethod = 'google-file-api';
          break;
        default:
          console.log('❌ Invalid choice. Using Google File API as default.');
          storageMethod = 'google-file-api';
      }

      console.log(`\n📤 Uploading file to ${storageMethod}...`);

      // Create form data for file upload
      const formData = new FormData();
      
      // Read file and create File object with proper MIME type
      const fs = await import('fs');
      const path = await import('path');
      const fileBuffer = await fs.promises.readFile(cleanFilePath);
      const fileName = path.basename(cleanFilePath);
      const mimeType = this.getMimeType(fileName);
      
      console.log(`📋 Detected file type: ${mimeType}`);
      
      const file = new File([fileBuffer], fileName, { type: mimeType });
      
      formData.append('files', file);
      formData.append('storageMethod', storageMethod);
      formData.append('userId', this.currentUser._id.toString());
      formData.append('conversationId', this.currentConversation.conversationId);
      formData.append('displayName', fileName);

      // Upload file
      const uploadResponse = await fetch('http://localhost:5000/api/files/upload', {
        method: 'POST',
        body: formData
      });

      const uploadResult = await uploadResponse.json();

      if (!uploadResult.success) {
        console.log('❌ File upload failed!');
        console.log(`📝 Error: ${uploadResult.error?.message || uploadResult.error || 'Unknown error'}`);
        if (uploadResult.error?.code) {
          console.log(`🔧 Error Code: ${uploadResult.error.code}`);
        }
        if (uploadResult.error?.details) {
          console.log(`ℹ️  Details: ${uploadResult.error.details}`);
        }
        console.log('\n💡 Common solutions:');
        console.log('   • Check if the file path is correct');
        console.log('   • Ensure the file is not corrupted');
        console.log('   • Try a smaller file if size limit exceeded');
        console.log('   • Check server logs for more details');
        console.log('   • Restart the server if needed');
        return;
      }

      const uploadedFile = uploadResult.files[0];
      console.log('✅ File uploaded successfully!');
      console.log(`📁 File ID: ${uploadedFile.fileId}`);
      console.log(`📦 Storage: ${uploadedFile.storageMethod}`);
      console.log(`📏 Size: ${(uploadedFile.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`🌐 URL: ${uploadedFile.url}`);
      if (uploadedFile.expiresAt) {
        console.log(`⏰ Expires: ${new Date(uploadedFile.expiresAt).toLocaleString()}`);
      }

      // Ask user what they want to know about the file
      console.log('\n🤖 AI Analysis Options:');
      console.log('=======================');
      console.log('1. Analyze/describe the file');
      console.log('2. Extract text content');
      console.log('3. Ask custom question about the file');
      console.log('4. Skip AI analysis');
      console.log('');

      const analysisChoice = await this.question('Choose analysis option (1-4): ');
      let analysisPrompt;

      switch (analysisChoice) {
        case '1':
          analysisPrompt = 'Please analyze this file and describe what you see in detail. Include any important information, patterns, or insights you can gather.';
          break;
        case '2':
          analysisPrompt = 'Please extract and provide all the text content from this file. If it\'s an image, provide any visible text. If it\'s audio, provide a transcription.';
          break;
        case '3':
          analysisPrompt = await this.question('Enter your question about the file: ');
          break;
        case '4':
          console.log('📁 File uploaded successfully. Skipping AI analysis.');
          return;
        default:
          console.log('❌ Invalid choice. Using default analysis.');
          analysisPrompt = 'Please analyze this file and describe what you see.';
      }

      // AI Configuration
      console.log('\n⚙️ AI Configuration:');
      console.log('====================');
      const model = await this.question('Enter model (default: gemini-2.5-flash): ') || 'gemini-2.5-flash';
      const temperature = parseFloat(await this.question('Enter temperature 0.0-2.0 (default: 0.7): ') || '0.7');
      const maxTokens = parseInt(await this.question('Enter max output tokens (default: 2048): ') || '2048');
      
      // Thinking configuration
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

      console.log('\n🤖 Analyzing file with AI...');

      // Send to AI for analysis
      const aiResponse = await fetch('http://localhost:5000/api/ai/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: this.currentUser._id.toString(),
          conversationId: this.currentConversation.conversationId,
          contents: analysisPrompt,
          files: [uploadedFile.fileId], // Use the uploaded file
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

      const aiResult = await aiResponse.json();

      if (aiResult.success) {
        console.log('\n✅ AI Analysis Complete!');
        console.log('========================');
        console.log(`📁 File: ${fileName}`);
        console.log(`📝 Your Question: ${analysisPrompt}`);
        console.log(`🤖 AI Response: ${aiResult.text}`);
        
        if (aiResult.thoughts && includeThoughts) {
          console.log(`🧠 AI Thoughts: ${aiResult.thoughts}`);
        }
        
        console.log('\n📊 Analysis Metadata:');
        console.log(`🎯 Tokens Used: ${aiResult.usageMetadata?.totalTokenCount || 0} (Input: ${aiResult.usageMetadata?.promptTokenCount || 0}, Output: ${aiResult.usageMetadata?.candidatesTokenCount || 0})`);
        console.log(`🌡️ Temperature: ${temperature}`);
        console.log(`🤖 Model: ${model}`);
        console.log(`🏢 Provider: ${aiResult.provider}`);
        
        if (aiResult.hasThoughtSignatures) {
          console.log(`🧠 Has Thought Signatures: Yes`);
        }

        // Ask if user wants to ask follow-up questions
        console.log('\n💬 Follow-up Options:');
        const followUp = await this.question('Ask another question about this file? (y/n): ');
        
        if (followUp.toLowerCase() === 'y') {
          const followUpQuestion = await this.question('Enter your follow-up question: ');
          
          console.log('\n🤖 Processing follow-up question...');
          
          const followUpResponse = await fetch('http://localhost:5000/api/ai/generate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              userId: this.currentUser._id.toString(),
              conversationId: this.currentConversation.conversationId,
              contents: followUpQuestion,
              files: [uploadedFile.fileId],
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

          const followUpResult = await followUpResponse.json();
          
          if (followUpResult.success) {
            console.log('\n✅ Follow-up Analysis Complete!');
            console.log('===============================');
            console.log(`📝 Follow-up Question: ${followUpQuestion}`);
            console.log(`🤖 AI Response: ${followUpResult.text}`);
            
            if (followUpResult.thoughts && includeThoughts) {
              console.log(`🧠 AI Thoughts: ${followUpResult.thoughts}`);
            }
          } else {
            console.log('❌ Follow-up analysis failed:', followUpResult.error);
          }
        }

      } else {
        console.log('❌ AI analysis failed:', aiResult.error);
        if (aiResult.details) {
          console.log('Details:', aiResult.details);
        }
        }
        
      } catch (error) {
      console.error('❌ Error during file upload and analysis:', error.message);
    }
  }

  // Helper function to detect MIME type from file extension
  getMimeType(fileName) {
    const ext = fileName.toLowerCase().split('.').pop();
    const mimeTypes = {
      // Images
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp',
      'svg': 'image/svg+xml',
      
      // Documents
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'txt': 'text/plain',
      'csv': 'text/csv',
      'rtf': 'application/rtf',
      
      // Audio
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'ogg': 'audio/ogg',
      'aac': 'audio/aac',
      'm4a': 'audio/mp4',
      'flac': 'audio/flac',
      
      // Video
      'mp4': 'video/mp4',
      'avi': 'video/x-msvideo',
      'mov': 'video/quicktime',
      'webm': 'video/webm',
      'mkv': 'video/x-matroska',
      'wmv': 'video/x-ms-wmv',
      
      // Other
      'json': 'application/json',
      'xml': 'application/xml',
      'zip': 'application/zip',
      'rar': 'application/x-rar-compressed'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }

  async regenerateResponse() {
    if (!this.currentUser) {
      console.log('❌ Please select a user first (option 10)');
      return;
    }

    if (!this.currentConversation) {
      console.log('❌ Please select a conversation first (option 3)');
      return;
    }

    try {
      // Get AI messages from the current conversation
      const aiMessages = await Message.find({
        conversationId: this.currentConversation.conversationId,
        userId: this.currentUser._id.toString(),
        role: 'model'
      }).sort({ messageSequence: 1 });

      if (aiMessages.length === 0) {
        console.log('📭 No AI messages found in this conversation');
        console.log('💡 Send a message to AI first (option 5)');
        return;
      }

      console.log('\n🔄 Regenerate AI Response');
      console.log('=========================');
      console.log('1. Regenerate last AI response (default)');
      console.log('2. Choose specific AI response to regenerate');
      console.log('');

      const regenerateChoice = await this.question('Choose option (1-2, default: 1): ') || '1';
      let messageToRegenerate = null;

      if (regenerateChoice === '2') {
        // Show AI messages for selection
        console.log('\n🤖 AI Messages in this Conversation:');
        console.log('===================================');
        aiMessages.forEach((msg, index) => {
          console.log(`${index + 1}. (Sequence: ${msg.messageSequence}) ${msg.content.text.substring(0, 100)}${msg.content.text.length > 100 ? '...' : ''}`);
          console.log(`   🕒 Created: ${msg.createdAt?.toLocaleString()}`);
          if (msg.metadata?.tokens?.total) {
            console.log(`   🎯 Tokens: ${msg.metadata.tokens.total}`);
          }
          console.log('');
        });

        const choice = await this.question(`Select an AI message to regenerate (1-${aiMessages.length}): `);
        const msgIndex = parseInt(choice) - 1;

        if (msgIndex < 0 || msgIndex >= aiMessages.length) {
          console.log('❌ Invalid selection');
          return;
        }

        messageToRegenerate = aiMessages[msgIndex];
      } else {
        // Use last AI message
        messageToRegenerate = aiMessages[aiMessages.length - 1];
      }

      console.log(`\n📝 Selected Message: ${messageToRegenerate.content.text.substring(0, 150)}${messageToRegenerate.content.text.length > 150 ? '...' : ''}`);
      console.log(`⚠️  Warning: This will delete all messages after sequence ${messageToRegenerate.messageSequence} and regenerate a new response`);
      
      const confirm = await this.question('Continue with regeneration? (y/n): ');
      if (confirm.toLowerCase() !== 'y') {
        console.log('❌ Regeneration cancelled');
        return;
      }

      // Enhanced configuration for the regenerated response
      console.log('\n⚙️ Configuration for Regenerated Response:');
      console.log('==========================================');
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

      console.log('\n🔄 Regenerating AI response...');

      const response = await fetch('http://localhost:5000/api/ai/regenerate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: this.currentUser._id.toString(),
          conversationId: this.currentConversation.conversationId,
          messageId: messageToRegenerate.messageId,
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
        console.log('\n✅ AI Response regenerated successfully!');
        console.log('=====================================');
        console.log(`🔄 Original Response (${result.originalMessage.messageSequence}): ${result.originalMessage.content.substring(0, 100)}${result.originalMessage.content.length > 100 ? '...' : ''}`);
        console.log(`🤖 New Response (${result.regeneratedMessage.messageSequence}): ${result.regeneratedMessage.content}`);
        
        if (result.thoughts && includeThoughts) {
          console.log(`🧠 AI Thoughts: ${result.thoughts}`);
        }
        
        console.log(`🗑️ Deleted ${result.deletedCount} subsequent messages`);
        
        console.log('\n📊 Response Metadata:');
        console.log(`🎯 Tokens Used: ${result.usageMetadata?.totalTokenCount || 0} (Input: ${result.usageMetadata?.promptTokenCount || 0}, Output: ${result.usageMetadata?.candidatesTokenCount || 0})`);
        console.log(`🌡️ Temperature: ${temperature}`);
        console.log(`🤖 Model: ${result.model}`);
        console.log(`🏢 Provider: ${result.provider}`);
        
        if (result.hasThoughtSignatures) {
          console.log(`🧠 Has Thought Signatures: Yes`);
        }

        console.log('\n📈 Conversation Stats:');
        console.log(`💬 Total Messages: ${result.conversationStats.totalMessages}`);
        console.log(`🎯 Total Tokens: ${result.conversationStats.totalTokens}`);
        
      } else {
        console.log('❌ Error regenerating response:', result.error);
        if (result.details) {
          console.log('Details:', result.details);
        }
      }
    } catch (error) {
      console.error('❌ Error regenerating response:', error.message);
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
            await this.deleteAllConversations();
            break;
          case '14':
            await this.deleteSpecificConversation();
            break;
          case '15':
            await this.fullUserRegistration();
            break;
          case '16':
            await this.logoutUser();
            break;
          case '17':
            await this.showDatabaseStatistics();
            break;
          case '18':
            await this.showUserSpecificStatistics();
            break;
          case '19':
            await this.uploadFileAndAnalyze();
            break;
          case '20':
            await this.regenerateResponse();
            break;
          case '21':
            console.log('👋 Goodbye!');
            await this.disconnect();
            rl.close();
            process.exit(0);
            break;
          default:
            console.log('❌ Invalid choice. Please select 1-21.');
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