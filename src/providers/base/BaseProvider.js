/**
 * Base class for all AI providers
 * This ensures a consistent interface across different AI services
 */
export class BaseProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = 'base';
    this.isInitialized = false;
  }

  /**
   * Initialize the provider with API keys and configurations
   */
  async initialize() {
    throw new Error('initialize method must be implemented by subclasses');
  }

  /**
   * Generate text content from various input types
   * @param {Object} params - Generation parameters
   * @param {string|Array} params.contents - Text content or multimodal content array
   * @param {Object} params.config - Generation configuration
   * @param {string} params.config.systemInstruction - System instructions
   * @param {number} params.config.temperature - Temperature setting
   * @param {number} params.config.maxOutputTokens - Maximum output tokens
   * @param {boolean} params.config.stream - Whether to stream responses
   * @param {Object} params.config.thinkingConfig - Thinking configuration
   * @param {Array} params.config.tools - Function tools

   * @returns {Promise<Object>} Generated response
   */
  async generateContent(params) {
    throw new Error('generateContent method must be implemented by subclasses');
  }

  /**
   * Generate streaming content
   * @param {Object} params - Same as generateContent
   * @returns {AsyncGenerator} Streaming response
   */
  async *generateContentStream(params) {
    throw new Error('generateContentStream method must be implemented by subclasses');
  }

  /**
   * Create or connect to a live session
   * @param {Object} params - Live session parameters
   * @param {string} params.model - Model to use
   * @param {Object} params.config - Session configuration
   * @param {Object} params.callbacks - WebSocket callbacks
   * @returns {Promise<Object>} Live session object
   */
  async createLiveSession(params) {
    throw new Error('createLiveSession method must be implemented by subclasses');
  }

  /**
   * Generate embeddings from text
   * @param {Object} params - Embedding parameters
   * @param {string|Array} params.contents - Content to embed
   * @param {string} params.model - Embedding model
   * @param {Object} params.config - Embedding configuration
   * @returns {Promise<Object>} Embeddings response
   */
  async generateEmbeddings(params) {
    throw new Error('generateEmbeddings method must be implemented by subclasses');
  }

  /**
   * Upload a file to the provider's storage
   * @param {Object} params - File upload parameters
   * @param {string|Buffer} params.file - File path or buffer
   * @param {Object} params.config - Upload configuration
   * @returns {Promise<Object>} Upload response
   */
  async uploadFile(params) {
    throw new Error('uploadFile method must be implemented by subclasses');
  }

  /**
   * Get file metadata
   * @param {string} name - File name/ID
   * @returns {Promise<Object>} File metadata
   */
  async getFile(name) {
    throw new Error('getFile method must be implemented by subclasses');
  }

  /**
   * List uploaded files
   * @param {Object} config - List configuration
   * @returns {Promise<Array>} List of files
   */
  async listFiles(config = {}) {
    throw new Error('listFiles method must be implemented by subclasses');
  }

  /**
   * Delete a file
   * @param {string} name - File name/ID
   * @returns {Promise<void>}
   */
  async deleteFile(name) {
    throw new Error('deleteFile method must be implemented by subclasses');
  }



  /**
   * Create ephemeral tokens for Live API
   * @param {Object} config - Token configuration
   * @returns {Promise<Object>} Token response
   */
  async createEphemeralToken(config) {
    throw new Error('createEphemeralToken method must be implemented by subclasses');
  }

  /**
   * Normalize input content to provider-specific format
   * @param {string|Array|Object} content - Input content
   * @returns {Object} Normalized content
   */
  normalizeContent(content) {
    if (typeof content === 'string') {
      return { text: content };
    }
    
    if (Array.isArray(content)) {
      return content.map(item => this.normalizeContent(item));
    }

    return content;
  }

  /**
   * Normalize configuration to provider-specific format
   * @param {Object} config - Input configuration
   * @returns {Object} Normalized configuration
   */
  normalizeConfig(config = {}) {
    return {
      temperature: config.temperature || 0.7,
      maxOutputTokens: config.maxOutputTokens || 2048,
      topP: config.topP || 0.9,
      topK: config.topK || 40,
      ...config
    };
  }

  /**
   * Validate that the provider is initialized
   */
  validateInitialization() {
    if (!this.isInitialized) {
      throw new Error(`${this.name} provider is not initialized`);
    }
  }

  /**
   * Get provider capabilities
   * @returns {Object} Capabilities object
   */
  getCapabilities() {
    return {
      textGeneration: false,
      multimodal: false,
      streaming: false,
      liveApi: false,
      embeddings: false,
      fileUpload: false,

      functionCalling: false,
      codeExecution: false,
      googleSearch: false
    };
  }

  /**
   * Get supported models
   * @returns {Array} Array of supported model names
   */
  getSupportedModels() {
    return [];
  }

  /**
   * Get provider name
   * @returns {string} Provider name
   */
  getName() {
    return this.name;
  }

  /**
   * Check if provider supports a specific feature
   * @param {string} feature - Feature name
   * @returns {boolean} Whether feature is supported
   */
  supportsFeature(feature) {
    const capabilities = this.getCapabilities();
    return capabilities[feature] || false;
  }
} 