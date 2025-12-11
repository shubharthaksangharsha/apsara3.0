#!/usr/bin/env node
/**
 * Test Gemini Live API Connection
 * 
 * Usage: node test-gemini-live-connection.js [API_KEY]
 * 
 * This script tests if your API key can connect to the Gemini Live API
 * and reports any quota/rate limit errors.
 */

import WebSocket from 'ws';

const API_KEY = process.argv[2] || process.env.GOOGLE_GEMINI_API_KEY || 'AIzaSyDWoWeK67MtYlA9S6NUM8lzOwmJIpwMWDA';
const MODEL = process.argv[3] || 'gemini-2.5-flash-native-audio-preview-09-2025';

const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

console.log('🔌 Gemini Live API Connection Test');
console.log('===================================');
console.log(`📝 Model: ${MODEL}`);
console.log(`🔑 API Key: ${API_KEY.substring(0, 10)}...${API_KEY.substring(API_KEY.length - 4)}`);
console.log(`🌐 URL: wss://generativelanguage.googleapis.com/ws/...`);
console.log('');

const startTime = Date.now();

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  const elapsed = Date.now() - startTime;
  console.log(`✅ WebSocket CONNECTED (${elapsed}ms)`);
  console.log('');
  
  // Determine if model requires audio modality
  const isNativeAudioModel = MODEL.includes('native-audio') || MODEL.includes('2.5-flash') && MODEL.includes('preview');
  const responseModalities = isNativeAudioModel ? ['AUDIO'] : ['TEXT'];
  
  console.log(`📝 Using response modality: ${responseModalities[0]}`);
  
  // Send setup message
  const setupMessage = {
    setup: {
      model: `models/${MODEL}`,
      generationConfig: {
        responseModalities: responseModalities,
      },
      systemInstruction: {
        parts: [{ text: 'You are a helpful assistant. Respond briefly.' }]
      }
    }
  };
  
  // Add speech config for audio models
  if (isNativeAudioModel) {
    setupMessage.setup.generationConfig.speechConfig = {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: 'Aoede'
        }
      }
    };
  }
  
  console.log('📤 Sending setup message...');
  ws.send(JSON.stringify(setupMessage));
});

ws.on('message', (data) => {
  const elapsed = Date.now() - startTime;
  try {
    const message = JSON.parse(data.toString());
    
    if (message.setupComplete) {
      console.log(`✅ Setup COMPLETE (${elapsed}ms)`);
      console.log('');
      console.log('🎉 SUCCESS! Your API key works with Gemini Live API!');
      console.log('');
      
      // Send a simple test message
      console.log('📤 Sending test message: "Hello, say hi briefly"');
      ws.send(JSON.stringify({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: 'Hello, say hi briefly' }] }],
          turnComplete: true
        }
      }));
    } else if (message.serverContent) {
      const sc = message.serverContent;
      
      // Handle text response
      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.text) {
            console.log(`🤖 Response: ${part.text}`);
          }
          if (part.inlineData?.mimeType?.startsWith('audio/')) {
            console.log(`🔊 Audio chunk received (${part.inlineData.data.length} bytes)`);
          }
        }
      }
      
      // Handle transcription (for audio models)
      if (sc.outputTranscription?.text) {
        console.log(`🤖 Transcription: ${sc.outputTranscription.text}`);
      }
      
      if (sc.turnComplete) {
        console.log('');
        console.log('✅ Turn complete - closing connection');
        ws.close();
      }
    } else {
      console.log(`📨 Message received (${elapsed}ms):`, JSON.stringify(message).substring(0, 200));
    }
  } catch (e) {
    console.log(`📨 Raw message (${elapsed}ms):`, data.toString().substring(0, 200));
  }
});

ws.on('error', (error) => {
  const elapsed = Date.now() - startTime;
  console.log(`❌ WebSocket ERROR (${elapsed}ms):`, error.message);
});

ws.on('close', (code, reason) => {
  const elapsed = Date.now() - startTime;
  const reasonStr = reason.toString();
  
  console.log('');
  console.log(`🔌 WebSocket CLOSED (${elapsed}ms)`);
  console.log(`   Code: ${code}`);
  console.log(`   Reason: ${reasonStr || '(none)'}`);
  console.log('');
  
  // Interpret the close code
  if (code === 1011) {
    console.log('❌ ERROR: Quota exceeded!');
    console.log('');
    console.log('This means your API project has hit its rate limit.');
    console.log('');
    console.log('📋 To fix this:');
    console.log('   1. Go to https://aistudio.google.com/apikey');
    console.log('   2. Find your project and click "Upgrade"');
    console.log('   3. Enable billing to get higher rate limits');
    console.log('');
    console.log('📊 Check your current usage at:');
    console.log('   https://aistudio.google.com/usage');
  } else if (code === 1000) {
    console.log('✅ Connection closed normally');
  } else if (code === 1006) {
    console.log('❌ Connection closed abnormally (network issue or server error)');
  } else if (code === 1008) {
    console.log('❌ Policy violation (check API key validity)');
  }
});

// Timeout after 30 seconds
setTimeout(() => {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    console.log('⏰ Test timeout (30s) - closing connection');
    ws.close();
  }
}, 30000);
