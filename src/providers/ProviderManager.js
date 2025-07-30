import { GoogleProvider } from './google/GoogleProvider.js';
// Future providers will be imported here
// import { ClaudeProvider } from './claude/ClaudeProvider.js';
// import { GrokProvider } from './grok/GrokProvider.js';

/**
 * Provider Manager
 * Manages multiple AI providers and provides a unified interface
 */
export class ProviderManager {
  constructor() {
    this.providers = new Map();
    this.defaultProvider = 'google';
    this.isInitialized = false;
  }

  /**
   * Initialize the provider manager and all providers
   */
  async initialize() {
    try {
      // Initialize Google provider
      const googleProvider = new GoogleProvider();
      await googleProvider.initialize();
      this.providers.set('google', googleProvider);

      // TODO: Initialize other providers when available
      // const claudeProvider = new ClaudeProvider();
      // await claudeProvider.initialize();
      // this.providers.set('claude', claudeProvider);

      // const grokProvider = new GrokProvider();
      // await grokProvider.initialize();
      // this.providers.set('grok', grokProvider);

      this.isInitialized = true;
      console.log(`✅ Provider Manager initialized with ${this.providers.size} providers`);
      console.log(`🎯 Available providers: ${Array.from(this.providers.keys()).join(', ')}`);
    } catch (error) {
      console.error('❌ Failed to initialize Provider Manager:', error);
      throw error;
    }
  }

  /**
   * Get a specific provider
   * @param {string} providerName - Name of the provider
   * @returns {BaseProvider} Provider instance
   */
  getProvider(providerName = this.defaultProvider) {
    if (!this.isInitialized) {
      throw new Error('Provider Manager is not initialized');
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider '${providerName}' not found. Available providers: ${this.getAvailableProviders().join(', ')}`);
    }

    return provider;
  }

  /**
   * Get all available provider names
   * @returns {string[]} Array of provider names
   */
  getAvailableProviders() {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a provider is available
   * @param {string} providerName - Name of the provider
   * @returns {boolean} Whether the provider is available
   */
  hasProvider(providerName) {
    return this.providers.has(providerName);
  }

  /**
   * Set the default provider
   * @param {string} providerName - Name of the provider to set as default
   */
  setDefaultProvider(providerName) {
    if (!this.hasProvider(providerName)) {
      throw new Error(`Provider '${providerName}' not found`);
    }
    this.defaultProvider = providerName;
    console.log(`🎯 Default provider set to: ${providerName}`);
  }

  /**
   * Generate content using specified or default provider
   * @param {Object} params - Generation parameters
   * @param {string} params.provider - Provider name (optional)
   * @returns {Promise<Object>} Generated response
   */
  async generateContent(params) {
    const { provider: providerName, ...restParams } = params;
    const provider = this.getProvider(providerName);
    return await provider.generateContent(restParams);
  }

  /**
   * Generate streaming content using specified or default provider
   * @param {Object} params - Generation parameters
   * @param {string} params.provider - Provider name (optional)
   * @returns {AsyncGenerator} Streaming response
   */
  async *generateContentStream(params) {
    const { provider: providerName, ...restParams } = params;
    const provider = this.getProvider(providerName);
    yield* provider.generateContentStream(restParams);
  }

  /**
   * Create a live session using specified or default provider
   * @param {Object} params - Live session parameters
   * @param {string} params.provider - Provider name (optional)
   * @returns {Promise<Object>} Live session object
   */
  async createLiveSession(params) {
    const { provider: providerName, ...restParams } = params;
    const provider = this.getProvider(providerName);
    return await provider.createLiveSession(restParams);
  }

  /**
   * Generate embeddings using specified or default provider
   * @param {Object} params - Embedding parameters
   * @param {string} params.provider - Provider name (optional)
   * @returns {Promise<Object>} Embeddings response
   */
  async generateEmbeddings(params) {
    const { provider: providerName, ...restParams } = params;
    const provider = this.getProvider(providerName);
    return await provider.generateEmbeddings(restParams);
  }

  /**
   * Upload a file using specified or default provider
   * @param {Object} params - File upload parameters
   * @param {string} params.provider - Provider name (optional)
   * @returns {Promise<Object>} Upload response
   */
  async uploadFile(params) {
    const { provider: providerName, ...restParams } = params;
    const provider = this.getProvider(providerName);
    return await provider.uploadFile(restParams);
  }

  /**
   * Get file metadata using specified or default provider
   * @param {string} name - File name/ID
   * @param {string} provider - Provider name (optional)
   * @returns {Promise<Object>} File metadata
   */
  async getFile(name, provider) {
    const providerInstance = this.getProvider(provider);
    return await providerInstance.getFile(name);
  }

  /**
   * List files using specified or default provider
   * @param {Object} config - List configuration
   * @param {string} config.provider - Provider name (optional)
   * @returns {Promise<Array>} List of files
   */
  async listFiles(config = {}) {
    const { provider: providerName, ...restConfig } = config;
    const provider = this.getProvider(providerName);
    return await provider.listFiles(restConfig);
  }

  /**
   * Delete a file using specified or default provider
   * @param {string} name - File name/ID
   * @param {string} provider - Provider name (optional)
   * @returns {Promise<void>}
   */
  async deleteFile(name, provider) {
    const providerInstance = this.getProvider(provider);
    return await providerInstance.deleteFile(name);
  }



  /**
   * Create ephemeral tokens using specified or default provider
   * @param {Object} config - Token configuration
   * @param {string} config.provider - Provider name (optional)
   * @returns {Promise<Object>} Token response
   */
  async createEphemeralToken(config) {
    const { provider: providerName, ...restConfig } = config;
    const provider = this.getProvider(providerName);
    return await provider.createEphemeralToken(restConfig);
  }

  /**
   * Get capabilities for all providers
   * @returns {Object} Capabilities by provider
   */
  getAllCapabilities() {
    const capabilities = {};
    for (const [name, provider] of this.providers) {
      const models = provider.getSupportedModels();
      capabilities[name] = {
        ...provider.getCapabilities(),
        models: Array.isArray(models) ? models : {
          rest: models.rest || [],
          live: models.live || [],
          embeddings: models.embeddings || []
        }
      };
    }
    return capabilities;
  }

  /**
   * Get capabilities for a specific provider
   * @param {string} providerName - Provider name
   * @returns {Object} Provider capabilities
   */
  getProviderCapabilities(providerName) {
    const provider = this.getProvider(providerName);
    const models = provider.getSupportedModels();
    return {
      ...provider.getCapabilities(),
      models: Array.isArray(models) ? models : {
        rest: models.rest || [],
        live: models.live || [],
        embeddings: models.embeddings || []
      }
    };
  }

  /**
   * Find providers that support a specific feature
   * @param {string} feature - Feature name
   * @returns {string[]} Array of provider names that support the feature
   */
  getProvidersWithFeature(feature) {
    const supportingProviders = [];
    for (const [name, provider] of this.providers) {
      if (provider.supportsFeature(feature)) {
        supportingProviders.push(name);
      }
    }
    return supportingProviders;
  }

  /**
   * Get the best provider for a specific model
   * @param {string} modelName - Model name
   * @returns {string|null} Provider name or null if not found
   */
  getProviderForModel(modelName) {
    for (const [name, provider] of this.providers) {
      const models = provider.getSupportedModels();
      // Handle both old format (array) and new format (object)
      if (Array.isArray(models)) {
        if (models.includes(modelName)) {
          return name;
        }
      } else {
        // New format with categorized models
        const allModels = [...(models.rest || []), ...(models.live || []), ...(models.embeddings || [])];
        if (allModels.includes(modelName)) {
          return name;
        }
      }
    }
    return null;
  }

  /**
   * Get provider statistics
   * @returns {Object} Provider statistics
   */
  getStats() {
    return {
      totalProviders: this.providers.size,
      availableProviders: this.getAvailableProviders(),
      defaultProvider: this.defaultProvider,
      capabilities: this.getAllCapabilities(),
      isInitialized: this.isInitialized
    };
  }
}

// Create and export a singleton instance
export default new ProviderManager(); 