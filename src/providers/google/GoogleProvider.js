import { GoogleGenAI, Modality, createUserContent, createPartFromUri } from '@google/genai';
import { BaseProvider } from '../base/BaseProvider.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Google Gemini AI Provider
 * Implements the BaseProvider interface for Google's Gemini models
 */
export class GoogleProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'google';
    this.client = null;
    this.apiKey = config.apiKey || process.env.GOOGLE_GEMINI_API_KEY;
  }

  /**
   * Initialize the Google provider
   */
  async initialize() {
    if (!this.apiKey) {
      throw new Error('Google API key is required');
    }

    try {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
      this.isInitialized = true;
      console.log('✅ Google Provider initialized');
    } catch (error) {
      throw new Error(`Failed to initialize Google provider: ${error.message}`);
    }
  }

  /**
   * Generate content using Gemini models
   */
  async generateContent(params) {
    this.validateInitialization();

    const { model = 'gemini-2.5-flash', contents, config = {} } = params;
    
    try {
      // Normalize and prepare the request
      const normalizedConfig = this.normalizeConfig(config);
      const requestParams = {
        model,
        contents: this.normalizeContent(contents),
        config: {
          ...normalizedConfig,
          ...(config.systemInstruction && { systemInstruction: config.systemInstruction }),
          ...(config.thinkingConfig && { thinkingConfig: config.thinkingConfig }),
          ...(config.tools && { tools: config.tools }),

        }
      };

      const response = await this.client.models.generateContent(requestParams);
      
      // Process thoughts in non-streaming response
      let thoughts = null;
      let hasThoughtSignatures = false;
      
      if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            // Check for thought parts
            if (part.thought && part.text) {
              thoughts = part.text;
            }
            // Check for thought signatures
            if (part.thoughtSignature) {
              hasThoughtSignatures = true;
            }
          }
        }
      }
      
      return {
        success: true,
        provider: this.name,
        model,
        text: response.text,
        thoughts,
        hasThoughtSignatures,
        response: response,
        usageMetadata: response.usageMetadata,
        finishReason: response.finishReason
      };
    } catch (error) {
      console.error('Google Provider Error:', error);
      throw this.createProviderError(error);
    }
  }

  /**
   * Generate streaming content
   */
  async *generateContentStream(params) {
    this.validateInitialization();

    const { model = 'gemini-2.5-flash', contents, config = {} } = params;
    
    try {
      const normalizedConfig = this.normalizeConfig(config);
      const requestParams = {
        model,
        contents: this.normalizeContent(contents),
        config: {
          ...normalizedConfig,
          ...(config.systemInstruction && { systemInstruction: config.systemInstruction }),
          ...(config.thinkingConfig && { thinkingConfig: config.thinkingConfig }),
          ...(config.tools && { tools: config.tools }),

        }
      };

      const stream = await this.client.models.generateContentStream(requestParams);
      
      let fullResponse = '';
      let fullThoughts = '';
      
      for await (const chunk of stream) {
        // Process the chunk to extract thoughts and content
        const processedChunk = this.processStreamChunk(chunk);
        
        // Skip null/empty chunks
        if (!processedChunk) {
          console.log(`⏭️ Skipping empty chunk`);
          continue;
        }
        
        // Accumulate response for logging
        if (processedChunk.text) {
          fullResponse += processedChunk.text;
        }
        if (processedChunk.thought) {
          fullThoughts += processedChunk.thought;
        }
        
        // Always yield chunks with content or end chunks
        if (processedChunk.text || processedChunk.thought || processedChunk.isEndChunk) {
          console.log(`📤 Yielding chunk - Model: ${model}, Text: "${processedChunk.text || ''}", Thought: "${processedChunk.thought || ''}", Thinking: ${processedChunk.isThinking}, EndChunk: ${processedChunk.isEndChunk || false}, Signatures: ${processedChunk.hasThoughtSignatures || false}`);
          
          yield {
            success: true,
            provider: this.name,
            model,
            text: processedChunk.text || '',
            thought: processedChunk.thought || null,
            isThinking: processedChunk.isThinking || false,
            hasThoughtSignatures: processedChunk.hasThoughtSignatures || false,
            isEndChunk: processedChunk.isEndChunk || false,
            chunk: chunk,
            usageMetadata: chunk.usageMetadata || processedChunk.usageMetadata,
            finishReason: chunk.finishReason
          };
        } else {
          console.log(`⏭️ Skipping chunk with no content`);
        }
      }
      
      // Log final response
      console.log(`✅ Final Response - Model: ${model}`);
      console.log(`📝 Generated Text: "${fullResponse}"`);
      if (fullThoughts) {
        console.log(`🧠 Thoughts: "${fullThoughts}"`);
      }
    } catch (error) {
      console.error('Google Provider Streaming Error:', error);
      throw this.createProviderError(error);
    }
  }

  /**
   * Create a live session for real-time interaction
   */
  async createLiveSession(params) {
    this.validateInitialization();

    const { model = 'gemini-2.0-flash-live-001', config = {}, callbacks = {} } = params;

    try {
      // Sanitize config to only include valid Live API parameters
      const validConfig = {};
      
      // Add only essential configuration properties
      if (config.responseModalities) {
        validConfig.responseModalities = config.responseModalities;
      }
      
      if (config.speechConfig) {
        // Keep the proper nested speechConfig structure as required by Gemini Live API
        const speechConfig = {};
        
        // Handle voice configuration - keep the nested structure
        if (config.speechConfig.voiceConfig?.prebuiltVoiceConfig?.voiceName) {
          speechConfig.voiceConfig = {
            prebuiltVoiceConfig: {
              voiceName: config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName
            }
          };
        }
        
        // Handle language configuration
        if (config.speechConfig.languageCode) {
          speechConfig.languageCode = config.speechConfig.languageCode;
        }
        
        if (Object.keys(speechConfig).length > 0) {
          validConfig.speechConfig = speechConfig;
        }
      }
      
      // Only include outputAudioTranscription if it's explicitly configured and not empty
      if (config.outputAudioTranscription && Object.keys(config.outputAudioTranscription).length > 0) {
        validConfig.outputAudioTranscription = config.outputAudioTranscription;
      }
      
      // Only include other properties if they're actually needed
      if (config.systemInstruction) validConfig.systemInstruction = config.systemInstruction;
      if (config.tools && Array.isArray(config.tools) && config.tools.length > 0) {
        validConfig.tools = config.tools;
      }
      
      console.log(`🔧 Final validConfig being sent to Gemini Live API:`, JSON.stringify(validConfig, null, 2));
      console.log(`🔧 Model being used:`, model);
      console.log(`🔧 Full connect parameters:`, JSON.stringify({ model, config: validConfig }, null, 2));
      
      const session = await this.client.live.connect({
        model,
        config: validConfig,
        callbacks: {
          onopen: callbacks.onopen || (() => console.log('🟢 Google Live session opened')),
          onmessage: callbacks.onmessage || ((message) => console.log('📨 Google Live message:', message)),
          onerror: callbacks.onerror || ((error) => console.error('🔴 Google Live session error:', error)),
          onclose: callbacks.onclose || ((reason) => console.log('🔴 Google Live session closed:', reason)),
          ...callbacks
        }
      });

      return {
        success: true,
        provider: this.name,
        model,
        session,
        sessionId: session.id || Date.now().toString()
      };
    } catch (error) {
      console.error('Google Live Session Error:', error);
      throw this.createProviderError(error);
    }
  }

  /**
   * Generate embeddings
   */
  async generateEmbeddings(params) {
    this.validateInitialization();

    const { model = 'gemini-embedding-exp-03-07', contents, config = {} } = params;

    try {
      const response = await this.client.models.embedContent({
        model,
        contents: this.normalizeContent(contents),
        config: {
          ...(config.taskType && { taskType: config.taskType }),
          ...config
        }
      });

      return {
        success: true,
        provider: this.name,
        model,
        embeddings: response.embeddings,
        usageMetadata: response.usageMetadata
      };
    } catch (error) {
      console.error('Google Embeddings Error:', error);
      throw this.createProviderError(error);
    }
  }

  /**
   * Upload a file
   */
  async uploadFile(params) {
    this.validateInitialization();

    const { file, config = {} } = params;

    try {
      const uploadResult = await this.client.files.upload({
        file,
        config: {
          mimeType: config.mimeType,
          displayName: config.displayName,
          ...config
        }
      });

      return {
        success: true,
        provider: this.name,
        file: uploadResult,
        uri: uploadResult.uri,
        name: uploadResult.name,
        mimeType: uploadResult.mimeType
      };
    } catch (error) {
      console.error('Google File Upload Error:', error);
      throw this.createProviderError(error);
    }
  }

  /**
   * Get file metadata
   */
  async getFile(name) {
    this.validateInitialization();

    try {
      const file = await this.client.files.get({ name });
      return {
        success: true,
        provider: this.name,
        file
      };
    } catch (error) {
      console.error('Google Get File Error:', error);
      throw this.createProviderError(error);
    }
  }

  /**
   * List files
   */
  async listFiles(config = {}) {
    this.validateInitialization();

    try {
      const listResponse = await this.client.files.list({ config });
      const files = [];
      
      for await (const file of listResponse) {
        files.push(file);
      }

      return {
        success: true,
        provider: this.name,
        files
      };
    } catch (error) {
      console.error('Google List Files Error:', error);
      throw this.createProviderError(error);
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(name) {
    this.validateInitialization();

    try {
      await this.client.files.delete({ name });
      return {
        success: true,
        provider: this.name,
        message: 'File deleted successfully'
      };
    } catch (error) {
      console.error('Google Delete File Error:', error);
      throw this.createProviderError(error);
    }
  }

  /**
   * Count tokens for given content
   */
  async countTokens(params) {
    this.validateInitialization();

    const { model = 'gemini-2.5-flash', contents } = params;

    try {
      const response = await this.client.models.countTokens({
        model,
        contents: this.normalizeContent(contents)
      });

      return {
        success: true,
        provider: this.name,
        model,
        totalTokens: response.totalTokens,
        response
      };
    } catch (error) {
      console.error('Google Count Tokens Error:', error);
      throw this.createProviderError(error);
    }
  }



  /**
   * Create ephemeral tokens
   */
  async createEphemeralToken(config) {
    this.validateInitialization();

    try {
      const token = await this.client.authTokens.create({
        config: {
          uses: config.uses || 1,
          expireTime: config.expireTime,
          newSessionExpireTime: config.newSessionExpireTime,
          liveConnectConstraints: config.liveConnectConstraints,
          httpOptions: { apiVersion: 'v1alpha' },
          ...config
        }
      });

      return {
        success: true,
        provider: this.name,
        token
      };
    } catch (error) {
      console.error('Google Create Token Error:', error);
      throw this.createProviderError(error);
    }
  }

  /**
   * Get provider capabilities
   */
  getCapabilities() {
    return {
      textGeneration: true,
      multimodal: true,
      streaming: true,
      liveApi: true,
      embeddings: true,
      fileUpload: true,

      functionCalling: true
      // Note: codeExecution and googleSearch are now handled as external plugins
    };
  }

  /**
   * Get supported models
   */
  getSupportedModels() {
    return {
      // REST API models (streaming-only)
      rest: [
        'gemini-2.5-flash',
        'gemini-2.5-pro'
      ],
      // Live API models
      live: [
        // Native audio models
        'gemini-2.5-flash-preview-native-audio-dialog',
        'gemini-2.5-flash-exp-native-audio-thinking-dialog',
        // Half-cascade models
        'gemini-live-2.5-flash-preview',
        'gemini-2.0-flash-live-001'
      ],
      // Embedding models
      embeddings: [
        'gemini-embedding-exp-03-07',
        'text-embedding-004',
        'embedding-001'
      ]
    };
  }

  /**
   * Get all supported models (flat list for backward compatibility)
   */
  getAllSupportedModels() {
    const models = this.getSupportedModels();
    return [...models.rest, ...models.live, ...models.embeddings];
  }

  /**
   * Create a provider-specific error
   */
  createProviderError(error) {
    const providerError = new Error(error.message || 'Google provider error');
    providerError.name = 'GoogleGenAIError';
    providerError.status = error.status || 500;
    providerError.provider = this.name;
    providerError.originalError = error;
    return providerError;
  }

  /**
   * Helper to create user content with multimodal support
   */
  createUserContent(parts) {
    return createUserContent(parts);
  }

  /**
   * Helper to create part from URI
   */
  createPartFromUri(uri, mimeType) {
    return createPartFromUri(uri, mimeType);
  }

  /**
   * Helper to process a stream chunk and extract thoughts and text
   * Based on Gemini thinking documentation
   */
  processStreamChunk(chunk) {
    let text = '';
    let thought = null;
    let isThinking = false;
    let hasThoughtSignatures = false;

    // Primary method: Direct text property (for backward compatibility)
    if (chunk.text && chunk.text.trim()) {
      text = chunk.text;
      console.log(`🔍 Direct text found: "${text}"`);
    }

    // Main method: Check candidates structure for parts
    if (chunk.candidates && chunk.candidates.length > 0) {
      const candidate = chunk.candidates[0];
      
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          // Handle thought parts (thought summaries)
          if (part.thought) {
            thought = part.text || ''; // The actual thought content is in part.text when part.thought is true
            isThinking = true;
            console.log(`🧠 Thought summary found: "${thought}"`);
          }
          // Handle regular text parts
          else if (part.text && part.text.trim()) {
            text = part.text;
            console.log(`📝 Text content found: "${text}"`);
          }

          // Check for thought signatures (for function calling)
          if (part.thoughtSignature) {
            hasThoughtSignatures = true;
            console.log(`🔐 Thought signature detected`);
          }
        }
      }

      // Fallback: Try to get text from candidate text property
      if (!text && !thought && candidate.text && candidate.text.trim()) {
        text = candidate.text;
        console.log(`📝 Candidate fallback text: "${text}"`);
      }
    }

    // Check for end of stream indicators
    if (chunk.usageMetadata && !text && !thought) {
      console.log(`🏁 End of stream chunk detected`);
      return { 
        text: '', 
        thought: null, 
        isThinking: false, 
        isEndChunk: true,
        hasThoughtSignatures,
        usageMetadata: chunk.usageMetadata 
      };
    }

    // Skip completely empty chunks
    if (!text && !thought) {
      console.log(`⚠️ Empty chunk - skipping`);
      return null; // Return null to indicate this chunk should be skipped
    }

    console.log(`✅ Processed chunk - Text: "${text}", Thought: "${thought || 'none'}", Thinking: ${isThinking}, Signatures: ${hasThoughtSignatures}`);
    return { text, thought, isThinking, hasThoughtSignatures };
  }
} 
