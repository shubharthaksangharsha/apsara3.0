#!/usr/bin/env node

/**
 * Apsara Backend Comprehensive Testing Script
 * 
 * This script tests all features of the Apsara backend including:
 * - REST API (streaming-only)
 * - Live API (WebSocket)
 * - File management
 * - Context caching
 * - Function calling
 * - Session management
 * 
 * Usage:
 * node test-apsara.js [feature]
 * 
 * Available features:
 * - all (default) - Run all tests
 * - rest - Test REST API endpoints
 * - live - Test Live API (WebSocket)
 * - files - Test file management
 * - cache - Test context caching
 * - tools - Test function calling
 * - sessions - Test session management
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const config = {
  baseUrl: 'http://localhost:5000',
  wsUrl: 'ws://localhost:5000/live',
  testTimeout: 30000,
  apiKey: process.env.GOOGLE_GEMINI_API_KEY || 'your-api-key-here'
};

// Test utilities
class TestRunner {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.results = [];
  }

  async assert(condition, message) {
    if (condition) {
      console.log(`✅ ${message}`);
      this.passed++;
      this.results.push({ status: 'PASS', message });
    } else {
      console.log(`❌ ${message}`);
      this.failed++;
      this.results.push({ status: 'FAIL', message });
    }
  }

  async assertEqual(actual, expected, message) {
    const condition = actual === expected;
    await this.assert(condition, `${message} (expected: ${expected}, got: ${actual})`);
  }

  async assertContains(text, substring, message) {
    const condition = text && text.includes(substring);
    await this.assert(condition, `${message} (text should contain: ${substring})`);
  }

  summary() {
    console.log('\n📊 Test Summary:');
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`📈 Success Rate: ${((this.passed / (this.passed + this.failed)) * 100).toFixed(1)}%`);
    
    if (this.failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.filter(r => r.status === 'FAIL').forEach(r => {
        console.log(`  - ${r.message}`);
      });
    }
  }
}

// Test data
const testData = {
  sampleText: "Hello, this is a test message for Apsara backend testing.",
  sampleImage: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  sampleAudio: "UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSqDye",
  samplePrompt: "Analyze the following content and provide a detailed summary.",
  functionDef: {
    name: 'get_current_time',
    description: 'Get the current time in a specific timezone',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'Timezone (e.g., America/New_York)'
        }
      },
      required: ['timezone']
    }
  }
};

// REST API Tests
class RestApiTests {
  constructor(testRunner) {
    this.test = testRunner;
    this.baseUrl = config.baseUrl;
  }

  async testHealthCheck() {
    console.log('\n🏥 Testing Health Check...');
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const data = await response.json();
      
      await this.test.assertEqual(response.status, 200, 'Health check returns 200');
      await this.test.assertEqual(data.status, 'healthy', 'Health check status is healthy');
      await this.test.assert(data.timestamp, 'Health check includes timestamp');
    } catch (error) {
      await this.test.assert(false, `Health check failed: ${error.message}`);
    }
  }

  async testStreamingGeneration() {
    console.log('\n📝 Testing Streaming Text Generation...');
    try {
      const response = await fetch(`${this.baseUrl}/api/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: testData.sampleText,
          model: 'gemini-2.5-flash',
          config: {
            temperature: 0.7,
            maxOutputTokens: 100
          }
        })
      });

      await this.test.assertEqual(response.status, 200, 'Generation request returns 200');
      await this.test.assertContains(response.headers.get('content-type'), 'text/plain', 'Response is streaming');

      // Test streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let chunks = 0;
      let hasData = false;

      while (chunks < 5) { // Read first few chunks
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        if (chunk.includes('data: ')) {
          hasData = true;
          chunks++;
        }
      }

      await this.test.assert(hasData, 'Received streaming data chunks');
    } catch (error) {
      await this.test.assert(false, `Streaming generation failed: ${error.message}`);
    }
  }

  async testModelValidation() {
    console.log('\n🔍 Testing Model Validation...');
    try {
      // Test valid model
      const validResponse = await fetch(`${this.baseUrl}/api/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: "test",
          model: 'gemini-2.5-pro'
        })
      });

      await this.test.assertEqual(validResponse.status, 200, 'Valid model (gemini-2.5-pro) accepted');

      // Test invalid model
      const invalidResponse = await fetch(`${this.baseUrl}/api/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: "test",
          model: 'invalid-model'
        })
      });

      await this.test.assertEqual(invalidResponse.status, 400, 'Invalid model rejected');
    } catch (error) {
      await this.test.assert(false, `Model validation test failed: ${error.message}`);
    }
  }

  async testChatConversation() {
    console.log('\n💬 Testing Chat Conversation...');
    try {
      const response = await fetch(`${this.baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              parts: [{ text: "Hello" }]
            },
            {
              role: "model",
              parts: [{ text: "Hi there! How can I help you?" }]
            },
            {
              role: "user",
              parts: [{ text: "What's 2+2?" }]
            }
          ],
          model: "gemini-2.5-flash"
        })
      });

      await this.test.assertEqual(response.status, 200, 'Chat request returns 200');
      await this.test.assertContains(response.headers.get('content-type'), 'text/plain', 'Chat response is streaming');
    } catch (error) {
      await this.test.assert(false, `Chat conversation failed: ${error.message}`);
    }
  }

  async testEmbeddings() {
    console.log('\n🧮 Testing Embeddings...');
    try {
      const response = await fetch(`${this.baseUrl}/api/ai/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: ["test text for embedding"],
          model: "text-embedding-004"
        })
      });

      const data = await response.json();
      await this.test.assertEqual(response.status, 200, 'Embeddings request returns 200');
      await this.test.assert(Array.isArray(data.embeddings), 'Response contains embeddings array');
    } catch (error) {
      await this.test.assert(false, `Embeddings test failed: ${error.message}`);
    }
  }

  async testProviderInfo() {
    console.log('\n🔌 Testing Provider Information...');
    try {
      const providersResponse = await fetch(`${this.baseUrl}/api/ai/providers`);
      const providersData = await providersResponse.json();

      await this.test.assertEqual(providersResponse.status, 200, 'Providers endpoint returns 200');
      await this.test.assert(providersData.data.capabilities.google, 'Google provider is available');

      const modelsResponse = await fetch(`${this.baseUrl}/api/ai/models`);
      const modelsData = await modelsResponse.json();

      await this.test.assertEqual(modelsResponse.status, 200, 'Models endpoint returns 200');
      await this.test.assert(modelsData.data.google.rest, 'REST models are listed');
      await this.test.assert(modelsData.data.google.live, 'Live models are listed');
    } catch (error) {
      await this.test.assert(false, `Provider info test failed: ${error.message}`);
    }
  }

  async runAll() {
    console.log('🔄 Running REST API Tests...');
    await this.testHealthCheck();
    await this.testStreamingGeneration();
    await this.testModelValidation();
    await this.testChatConversation();
    await this.testEmbeddings();
    await this.testProviderInfo();
  }
}

// Live API Tests
class LiveApiTests {
  constructor(testRunner) {
    this.test = testRunner;
    this.wsUrl = config.wsUrl;
    this.sessions = new Map();
  }

  async createWebSocketConnection() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      
      ws.on('open', () => {
        resolve(ws);
      });
      
      ws.on('error', (error) => {
        reject(error);
      });

      setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
      }, 5000);
    });
  }

  async testWebSocketConnection() {
    console.log('\n🔌 Testing WebSocket Connection...');
    try {
      const ws = await this.createWebSocketConnection();
      await this.test.assert(ws.readyState === WebSocket.OPEN, 'WebSocket connection established');
      ws.close();
    } catch (error) {
      await this.test.assert(false, `WebSocket connection failed: ${error.message}`);
    }
  }

  async testSessionCreation() {
    console.log('\n🎯 Testing Session Creation...');
    try {
      const ws = await this.createWebSocketConnection();
      let sessionCreated = false;
      let sessionId = null;

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session_created') {
          sessionCreated = true;
          sessionId = message.sessionId;
        }
      });

      // Create session with default model
      ws.send(JSON.stringify({
        type: 'create_session',
        data: {
          model: 'gemini-2.0-flash-live-001', // Using the model the user changed to
          config: {
            responseModalities: ['TEXT']
          }
        }
      }));

      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 2000));

      await this.test.assert(sessionCreated, 'Session created successfully');
      
      if (sessionId) {
        this.sessions.set('test-session', sessionId);
      }

      ws.close();
    } catch (error) {
      await this.test.assert(false, `Session creation failed: ${error.message}`);
    }
  }

  async testNativeAudioSession() {
    console.log('\n🎵 Testing Native Audio Session...');
    try {
      const ws = await this.createWebSocketConnection();
      let sessionCreated = false;

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session_created') {
          sessionCreated = true;
        }
      });

      ws.send(JSON.stringify({
        type: 'create_session',
        data: {
          model: 'gemini-2.5-flash-preview-native-audio-dialog',
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { 
                prebuiltVoiceConfig: { voiceName: "Kore" } 
              }
            },
            enableAffectiveDialog: true
          }
        }
      }));

      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.test.assert(sessionCreated, 'Native audio session created');

      ws.close();
    } catch (error) {
      await this.test.assert(false, `Native audio session failed: ${error.message}`);
    }
  }

  async testSendMessage() {
    console.log('\n💌 Testing Send Message...');
    try {
      const ws = await this.createWebSocketConnection();
      let sessionId = null;
      let messageReceived = false;

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session_created') {
          sessionId = message.sessionId;
          
          // Send message with new structure
          ws.send(JSON.stringify({
            type: 'send_message',
            data: {
              sessionId: sessionId,
              text: 'Hello, this is a test message',
              turnComplete: true
            }
          }));
        } else if (message.type === 'session_message') {
          messageReceived = true;
        }
      });

      ws.send(JSON.stringify({
        type: 'create_session',
        data: {
          model: 'gemini-2.0-flash-live-001',
          config: { responseModalities: ['TEXT'] }
        }
      }));

      await new Promise(resolve => setTimeout(resolve, 5000));
      await this.test.assert(messageReceived, 'Message sent and response received');

      ws.close();
    } catch (error) {
      await this.test.assert(false, `Send message test failed: ${error.message}`);
    }
  }

  async testRealtimeInput() {
    console.log('\n🎬 Testing Realtime Input...');
    try {
      const ws = await this.createWebSocketConnection();
      let sessionId = null;
      let inputSent = false;

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session_created') {
          sessionId = message.sessionId;
          
          // Test audio input
          ws.send(JSON.stringify({
            type: 'send_realtime_input',
            data: {
              sessionId: sessionId,
              audio: {
                data: testData.sampleAudio,
                mimeType: 'audio/pcm;rate=16000'
              }
            }
          }));

          // Test image input
          ws.send(JSON.stringify({
            type: 'send_realtime_input',
            data: {
              sessionId: sessionId,
              image: {
                data: testData.sampleImage.split(',')[1],
                mimeType: 'image/png'
              }
            }
          }));

          inputSent = true;
        }
      });

      ws.send(JSON.stringify({
        type: 'create_session',
        data: {
          model: 'gemini-2.0-flash-live-001',
          config: { responseModalities: ['TEXT'] }
        }
      }));

      await new Promise(resolve => setTimeout(resolve, 3000));
      await this.test.assert(inputSent, 'Realtime input sent successfully');

      ws.close();
    } catch (error) {
      await this.test.assert(false, `Realtime input test failed: ${error.message}`);
    }
  }

  async testIncrementalUpdate() {
    console.log('\n🔄 Testing Incremental Content Update...');
    try {
      const ws = await this.createWebSocketConnection();
      let sessionId = null;
      let updateSent = false;

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session_created') {
          sessionId = message.sessionId;
          
          // Send incremental update
          ws.send(JSON.stringify({
            type: 'send_incremental_update',
            data: {
              sessionId: sessionId,
              turns: [
                { "role": "user", "parts": [{ "text": "What is AI?" }] },
                { "role": "model", "parts": [{ "text": "AI is artificial intelligence." }] }
              ],
              turnComplete: false
            }
          }));

          updateSent = true;
        }
      });

      ws.send(JSON.stringify({
        type: 'create_session',
        data: {
          model: 'gemini-2.0-flash-live-001',
          config: { responseModalities: ['TEXT'] }
        }
      }));

      await new Promise(resolve => setTimeout(resolve, 3000));
      await this.test.assert(updateSent, 'Incremental update sent successfully');

      ws.close();
    } catch (error) {
      await this.test.assert(false, `Incremental update test failed: ${error.message}`);
    }
  }

  async testFunctionCalling() {
    console.log('\n⚙️ Testing Function Calling...');
    try {
      const ws = await this.createWebSocketConnection();
      let sessionId = null;
      let functionCallReceived = false;

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session_created') {
          sessionId = message.sessionId;
          
          ws.send(JSON.stringify({
            type: 'send_message',
            data: {
              sessionId: sessionId,
              text: 'What time is it in New York?',
              turnComplete: true
            }
          }));
        } else if (message.type === 'session_message' && message.data.serverContent?.toolCall) {
          functionCallReceived = true;
          
          // Send tool response
          ws.send(JSON.stringify({
            type: 'send_tool_response',
            data: {
              sessionId: sessionId,
              functionResponses: [{
                id: message.data.serverContent.toolCall.functionCalls[0].id,
                name: 'get_current_time',
                response: { result: '{"time": "2024-01-15 10:30:00", "timezone": "America/New_York"}' }
              }]
            }
          }));
        }
      });

      ws.send(JSON.stringify({
        type: 'create_session',
        data: {
          model: 'gemini-2.0-flash-live-001',
          config: {
            responseModalities: ['TEXT'],
            tools: [{
              functionDeclarations: [testData.functionDef]
            }]
          }
        }
      }));

      await new Promise(resolve => setTimeout(resolve, 5000));
      await this.test.assert(functionCallReceived, 'Function calling works correctly');

      ws.close();
    } catch (error) {
      await this.test.assert(false, `Function calling test failed: ${error.message}`);
    }
  }

  async runAll() {
    console.log('🚀 Running Live API Tests...');
    await this.testWebSocketConnection();
    await this.testSessionCreation();
    await this.testNativeAudioSession();
    await this.testSendMessage();
    await this.testRealtimeInput();
    await this.testIncrementalUpdate();
    await this.testFunctionCalling();
  }
}

// File Management Tests
class FileTests {
  constructor(testRunner) {
    this.test = testRunner;
    this.baseUrl = config.baseUrl;
    this.uploadedFileId = null;
  }

  async createTestFile() {
    const testContent = 'This is a test file for Apsara backend testing.\n\nIt contains some sample text to analyze.';
    const filePath = path.join(__dirname, 'test-file.txt');
    fs.writeFileSync(filePath, testContent);
    return filePath;
  }

  async testFileUpload() {
    console.log('\n📁 Testing File Upload...');
    try {
      const testFilePath = await this.createTestFile();
      const formData = new FormData();
      
      const fileData = fs.readFileSync(testFilePath);
      const blob = new Blob([fileData], { type: 'text/plain' });
      formData.append('files', blob, 'test-file.txt');

      const response = await fetch(`${this.baseUrl}/api/files/upload`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      
      await this.test.assertEqual(response.status, 200, 'File upload returns 200');
      await this.test.assert(data.success, 'File upload successful');
      await this.test.assert(Array.isArray(data.files), 'Response contains files array');

      if (data.files && data.files.length > 0) {
        this.uploadedFileId = data.files[0].id;
      }

      // Cleanup
      fs.unlinkSync(testFilePath);
    } catch (error) {
      await this.test.assert(false, `File upload test failed: ${error.message}`);
    }
  }

  async testFileAnalysis() {
    console.log('\n🔍 Testing File Analysis...');
    try {
      const testFilePath = await this.createTestFile();
      const formData = new FormData();
      
      const fileData = fs.readFileSync(testFilePath);
      const blob = new Blob([fileData], { type: 'text/plain' });
      formData.append('file', blob, 'test-file.txt');
      formData.append('prompt', 'Summarize this text file');
      formData.append('model', 'gemini-2.5-flash');

      const response = await fetch(`${this.baseUrl}/api/files/analyze-local`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      
      await this.test.assertEqual(response.status, 200, 'File analysis returns 200');
      await this.test.assert(data.success, 'File analysis successful');
      await this.test.assert(data.analysis && data.analysis.text, 'Analysis contains text response');

      // Cleanup
      fs.unlinkSync(testFilePath);
    } catch (error) {
      await this.test.assert(false, `File analysis test failed: ${error.message}`);
    }
  }

  async testSupportedTypes() {
    console.log('\n📋 Testing Supported File Types...');
    try {
      const response = await fetch(`${this.baseUrl}/api/files/supported-types`);
      const data = await response.json();

      await this.test.assertEqual(response.status, 200, 'Supported types endpoint returns 200');
      await this.test.assert(data.supportedTypes, 'Response contains supported types');
      await this.test.assert(Array.isArray(data.supportedTypes.images), 'Image types listed');
      await this.test.assert(Array.isArray(data.supportedTypes.documents), 'Document types listed');
    } catch (error) {
      await this.test.assert(false, `Supported types test failed: ${error.message}`);
    }
  }

  async runAll() {
    console.log('📂 Running File Management Tests...');
    await this.testFileUpload();
    await this.testFileAnalysis();
    await this.testSupportedTypes();
  }
}

// Context Caching Tests
class CacheTests {
  constructor(testRunner) {
    this.test = testRunner;
    this.baseUrl = config.baseUrl;
    this.cacheId = null;
  }

  async testCacheCreation() {
    console.log('\n💾 Testing Cache Creation...');
    try {
      const response = await fetch(`${this.baseUrl}/api/cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-2.5-pro',
          contents: 'This is a long document that we want to cache for efficient reuse. ' + 
                   'It contains important information that will be referenced multiple times.',
          systemInstruction: 'You are a helpful assistant that analyzes documents.',
          ttl: '3600s'
        })
      });

      const data = await response.json();
      
      await this.test.assertEqual(response.status, 200, 'Cache creation returns 200');
      await this.test.assert(data.success, 'Cache creation successful');
      await this.test.assert(data.cache && data.cache.name, 'Cache has ID');

      this.cacheId = data.cache.name;
    } catch (error) {
      await this.test.assert(false, `Cache creation test failed: ${error.message}`);
    }
  }

  async testCacheUsage() {
    console.log('\n🔄 Testing Cache Usage...');
    if (!this.cacheId) {
      await this.test.assert(false, 'No cache ID available for testing');
      return;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/cache/${this.cacheId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemini-2.5-pro',
          contents: 'Summarize the key points from the cached document'
        })
      });

      await this.test.assertEqual(response.status, 200, 'Cache usage returns 200');
      await this.test.assertContains(response.headers.get('content-type'), 'text/plain', 'Cache response is streaming');
    } catch (error) {
      await this.test.assert(false, `Cache usage test failed: ${error.message}`);
    }
  }

  async testCacheList() {
    console.log('\n📝 Testing Cache List...');
    try {
      const response = await fetch(`${this.baseUrl}/api/cache`);
      const data = await response.json();

      await this.test.assertEqual(response.status, 200, 'Cache list returns 200');
      await this.test.assert(Array.isArray(data.caches), 'Response contains caches array');
    } catch (error) {
      await this.test.assert(false, `Cache list test failed: ${error.message}`);
    }
  }

  async runAll() {
    console.log('🗄️ Running Context Caching Tests...');
    await this.testCacheCreation();
    await this.testCacheUsage();
    await this.testCacheList();
  }
}

// Tools Tests
class ToolsTests {
  constructor(testRunner) {
    this.test = testRunner;
    this.baseUrl = config.baseUrl;
  }

  async testFunctionCalling() {
    console.log('\n🔧 Testing Function Calling...');
    try {
      const response = await fetch(`${this.baseUrl}/api/tools/function-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: 'What time is it in Tokyo?',
          model: 'gemini-2.5-flash',
          tools: [{
            functionDeclarations: [testData.functionDef]
          }]
        })
      });

      await this.test.assertEqual(response.status, 200, 'Function calling returns 200');
      await this.test.assertContains(response.headers.get('content-type'), 'text/plain', 'Function calling response is streaming');
    } catch (error) {
      await this.test.assert(false, `Function calling test failed: ${error.message}`);
    }
  }

  async testToolCapabilities() {
    console.log('\n📊 Testing Tool Capabilities...');
    try {
      const response = await fetch(`${this.baseUrl}/api/tools/capabilities`);
      const data = await response.json();

      await this.test.assertEqual(response.status, 200, 'Tool capabilities returns 200');
      await this.test.assert(data.capabilities, 'Response contains capabilities');
      await this.test.assert(data.capabilities.google, 'Google provider capabilities listed');
    } catch (error) {
      await this.test.assert(false, `Tool capabilities test failed: ${error.message}`);
    }
  }

  async testToolValidation() {
    console.log('\n✅ Testing Tool Validation...');
    try {
      const response = await fetch(`${this.baseUrl}/api/tools/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          tools: [{
            functionDeclarations: [testData.functionDef]
          }]
        })
      });

      const data = await response.json();
      
      await this.test.assertEqual(response.status, 200, 'Tool validation returns 200');
      await this.test.assert(Array.isArray(data.validationResults), 'Response contains validation results');
    } catch (error) {
      await this.test.assert(false, `Tool validation test failed: ${error.message}`);
    }
  }

  async runAll() {
    console.log('🛠️ Running Tools Tests...');
    await this.testFunctionCalling();
    await this.testToolCapabilities();
    await this.testToolValidation();
  }
}

// Session Management Tests
class SessionTests {
  constructor(testRunner) {
    this.test = testRunner;
    this.baseUrl = config.baseUrl;
  }

  async testEphemeralToken() {
    console.log('\n🎫 Testing Ephemeral Token Creation...');
    try {
      const response = await fetch(`${this.baseUrl}/api/sessions/ephemeral-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uses: 5,
          expireTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour
          liveConnectConstraints: {
            model: 'gemini-2.0-flash-live-001',
            config: {
              responseModalities: ['TEXT']
            }
          }
        })
      });

      const data = await response.json();
      
      await this.test.assertEqual(response.status, 200, 'Ephemeral token creation returns 200');
      await this.test.assert(data.success, 'Ephemeral token creation successful');
      await this.test.assert(data.token, 'Response contains token');
    } catch (error) {
      await this.test.assert(false, `Ephemeral token test failed: ${error.message}`);
    }
  }

  async testLiveApiModels() {
    console.log('\n🎵 Testing Live API Models...');
    try {
      const response = await fetch(`${this.baseUrl}/api/sessions/models`);
      const data = await response.json();

      await this.test.assertEqual(response.status, 200, 'Live API models returns 200');
      await this.test.assert(Array.isArray(data.models), 'Response contains models array');
      await this.test.assert(data.models.includes('gemini-2.0-flash-live-001'), 'Contains expected live model');
    } catch (error) {
      await this.test.assert(false, `Live API models test failed: ${error.message}`);
    }
  }

  async testLiveApiFeatures() {
    console.log('\n✨ Testing Live API Features...');
    try {
      const response = await fetch(`${this.baseUrl}/api/sessions/features`);
      const data = await response.json();

      await this.test.assertEqual(response.status, 200, 'Live API features returns 200');
      await this.test.assert(data.features, 'Response contains features');
      await this.test.assert(data.features.tools, 'Features include tools support');
    } catch (error) {
      await this.test.assert(false, `Live API features test failed: ${error.message}`);
    }
  }

  async testSessionHealth() {
    console.log('\n🏥 Testing Session Health...');
    try {
      const response = await fetch(`${this.baseUrl}/api/sessions/health`);
      const data = await response.json();

      await this.test.assertEqual(response.status, 200, 'Session health returns 200');
      await this.test.assert(data.websocket, 'Health includes WebSocket status');
    } catch (error) {
      await this.test.assert(false, `Session health test failed: ${error.message}`);
    }
  }

  async runAll() {
    console.log('🎯 Running Session Management Tests...');
    await this.testEphemeralToken();
    await this.testLiveApiModels();
    await this.testLiveApiFeatures();
    await this.testSessionHealth();
  }
}

// Main test runner
async function runTests(feature = 'all') {
  console.log('🚀 Apsara Backend Testing Script');
  console.log('=================================\n');
  
  const testRunner = new TestRunner();
  
  // Check if server is running
  try {
    const healthResponse = await fetch(`${config.baseUrl}/health`);
    if (!healthResponse.ok) {
      throw new Error('Server health check failed');
    }
  } catch (error) {
    console.log('❌ Server is not running or not accessible');
    console.log('   Please start the server with: npm run dev');
    process.exit(1);
  }

  console.log('✅ Server is running and accessible\n');

  // Initialize test classes
  const restTests = new RestApiTests(testRunner);
  const liveTests = new LiveApiTests(testRunner);
  const fileTests = new FileTests(testRunner);
  const cacheTests = new CacheTests(testRunner);
  const toolsTests = new ToolsTests(testRunner);
  const sessionTests = new SessionTests(testRunner);

  try {
    switch (feature.toLowerCase()) {
      case 'rest':
        await restTests.runAll();
        break;
      case 'live':
        await liveTests.runAll();
        break;
      case 'files':
        await fileTests.runAll();
        break;
      case 'cache':
        await cacheTests.runAll();
        break;
      case 'tools':
        await toolsTests.runAll();
        break;
      case 'sessions':
        await sessionTests.runAll();
        break;
      case 'all':
      default:
        await restTests.runAll();
        await liveTests.runAll();
        await fileTests.runAll();
        await cacheTests.runAll();
        await toolsTests.runAll();
        await sessionTests.runAll();
        break;
    }
  } catch (error) {
    console.log(`\n❌ Test execution error: ${error.message}`);
  }

  testRunner.summary();
  
  if (testRunner.failed > 0) {
    process.exit(1);
  }
}

// CLI handling
const feature = process.argv[2] || 'all';

if (feature === '--help' || feature === '-h') {
  console.log(`
Apsara Backend Testing Script

Usage: node test-apsara.js [feature]

Available features:
  all      - Run all tests (default)
  rest     - Test REST API endpoints only
  live     - Test Live API (WebSocket) only
  files    - Test file management only
  cache    - Test context caching only
  tools    - Test function calling only
  sessions - Test session management only

Examples:
  node test-apsara.js           # Run all tests
  node test-apsara.js rest      # Test only REST API
  node test-apsara.js live      # Test only Live API
  
Make sure your server is running before executing tests:
  npm run dev
`);
  process.exit(0);
}

runTests(feature).catch(console.error); 