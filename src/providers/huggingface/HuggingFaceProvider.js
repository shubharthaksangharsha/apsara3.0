import { HfInference } from '@huggingface/inference';
import { BaseProvider } from '../base/BaseProvider.js';

/**
 * Hugging Face Provider
 * Provides text summarization and other NLP capabilities using Hugging Face models
 */
export class HuggingFaceProvider extends BaseProvider {
  constructor() {
    super('huggingface');
    this.client = null;
    // Using a smaller, faster model for better performance
    this.defaultSummarizationModel = 'sshleifer/distilbart-cnn-12-6'; // Faster than bart-large-cnn
    this.isInitialized = false;
  }

  /**
   * Initialize the Hugging Face provider
   */
  async initialize() {
    try {
      const apiKey = process.env.hugging;
      
      // HuggingFace API key is optional - free tier works without it but has rate limits
      if (apiKey) {
        this.client = new HfInference(apiKey);
        console.log('✅ HuggingFace Provider initialized with API key');
      } else {
        this.client = new HfInference();
        console.log('⚠️  HuggingFace Provider initialized without API key (using free tier with rate limits)');
        console.log('💡 Add hugging to .env for higher rate limits');
      }
      
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize HuggingFace Provider:', error);
      throw error;
    }
  }

  /**
   * Generate a concise chat title from conversation text
   * @param {string} conversationText - The conversation text to summarize
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated title and metadata
   */
  async generateChatTitle(conversationText, options = {}) {
    if (!this.isInitialized) {
      throw new Error('HuggingFaceProvider is not initialized');
    }

    const {
      maxLength = 10, // Maximum words in title
      minLength = 3,  // Minimum words in title
      model = this.defaultSummarizationModel,
      useAI = false // By default, use fallback (faster and more reliable)
    } = options;

    // If AI is not explicitly requested, use fast fallback
    if (!useAI) {
      console.log('🎯 Using fast smart extraction for title...');
      const fallbackTitle = this._createFallbackTitle(conversationText);
      return {
        success: true,
        title: fallbackTitle,
        provider: 'huggingface',
        method: 'smart-extraction'
      };
    }

    try {
      // Use summarization model which is available on free tier
      console.log('🤖 Generating chat title with HuggingFace AI...');
      console.log(`📝 Model: ${this.defaultSummarizationModel}`);
      console.log(`📏 Conversation length: ${conversationText.length} characters`);

      // Truncate conversation if too long (summarization models have limits)
      let inputText = conversationText;
      if (conversationText.length > 1000) {
        inputText = conversationText.substring(0, 1000);
        console.log(`⚠️  Truncated conversation to 1000 characters`);
      }

      console.log('⏳ Waiting for AI response (this may take 10-30 seconds for cold start)...');

      // Use summarization to create a concise summary, then extract title
      // Add timeout wrapper (reduced to 15 seconds for faster fallback)
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout after 15 seconds')), 15000)
      );

      const summaryPromise = this.client.summarization({
        model: this.defaultSummarizationModel,
        inputs: inputText,
        parameters: {
          max_length: 15, // Short summary
          min_length: 5
        }
      });

      const result = await Promise.race([summaryPromise, timeoutPromise]);

      // Extract and clean the summary to make it title-like
      let title = result.summary_text.trim();
      
      // Clean up the title to be more title-like
      title = this._cleanTitle(title);
      
      console.log(`✅ Generated title: "${title}"`);

      return {
        success: true,
        title,
        model: this.defaultSummarizationModel,
        provider: 'huggingface',
        method: 'summarization'
      };
    } catch (error) {
      console.error('❌ HuggingFace title generation error:', error);
      
      // Fallback: extract from first line
      const fallbackTitle = this._createFallbackTitle(conversationText);
      
      return {
        success: false,
        title: fallbackTitle,
        error: error.message,
        provider: 'huggingface',
        method: 'fallback'
      };
    }
  }

  /**
   * Summarize text using Hugging Face models
   * @param {string} text - Text to summarize
   * @param {Object} options - Summarization options
   * @returns {Promise<Object>} Summary and metadata
   */
  async summarizeText(text, options = {}) {
    if (!this.isInitialized) {
      throw new Error('HuggingFaceProvider is not initialized');
    }

    const {
      maxLength = 100,
      minLength = 30,
      model = this.defaultSummarizationModel
    } = options;

    try {
      console.log(`🤖 Summarizing text with model: ${model}`);
      
      const result = await this.client.summarization({
        model,
        inputs: text,
        parameters: {
          max_length: maxLength,
          min_length: minLength
        }
      });

      return {
        success: true,
        summary: result.summary_text,
        model,
        provider: 'huggingface'
      };
    } catch (error) {
      console.error('❌ HuggingFace summarization error:', error);
      throw error;
    }
  }

  /**
   * Clean and format the generated title
   * @private
   */
  _cleanTitle(title) {
    // Remove common unwanted patterns
    title = title
      .replace(/^(Title:|Chat:|Conversation:)\s*/i, '') // Remove prefixes
      .replace(/^["']|["']$/g, '') // Remove quotes
      .replace(/\n.*/g, '') // Take only first line
      .trim();

    // Limit to 6 words maximum
    const words = title.split(/\s+/);
    if (words.length > 6) {
      title = words.slice(0, 6).join(' ') + '...';
    }

    // Limit to 60 characters
    if (title.length > 60) {
      title = title.substring(0, 57) + '...';
    }

    // Capitalize first letter
    if (title.length > 0) {
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }

    // Fallback if title is too short or empty
    if (title.length < 3) {
      title = 'New Conversation';
    }

    return title;
  }

  /**
   * Create a fallback title from conversation text
   * @private
   */
  _createFallbackTitle(conversationText) {
    // Extract first user message or first meaningful line
    const lines = conversationText.split('\n').filter(line => line.trim().length > 0);
    
    for (const line of lines) {
      // Look for user message
      const userMatch = line.match(/^User:\s*(.+)/i);
      if (userMatch) {
        let title = userMatch[1].trim();
        // Limit to first 50 characters
        if (title.length > 50) {
          title = title.substring(0, 47) + '...';
        }
        return title;
      }
    }

    // If no user message found, use first line
    if (lines.length > 0) {
      let title = lines[0].trim();
      if (title.length > 50) {
        title = title.substring(0, 47) + '...';
      }
      return title;
    }

    return 'New Conversation';
  }

  /**
   * Health check for the provider
   */
  async healthCheck() {
    try {
      if (!this.isInitialized) {
        return {
          status: 'error',
          message: 'Provider not initialized'
        };
      }

      // Quick test with summarization (which is available on free tier)
      await this.client.summarization({
        model: this.defaultSummarizationModel,
        inputs: 'This is a test message to check if the API is working.',
        parameters: {
          max_length: 10,
          min_length: 5
        }
      });

      return {
        status: 'healthy',
        provider: 'huggingface',
        models: {
          summarization: this.defaultSummarizationModel
        }
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message
      };
    }
  }

  /**
   * Get provider capabilities
   */
  getCapabilities() {
    return {
      provider: 'huggingface',
      capabilities: [
        'text-summarization',
        'chat-title-generation'
      ],
      models: {
        summarization: this.defaultSummarizationModel
      },
      rateLimit: {
        free: '1000 requests/day (no API key required)',
        withApiKey: '30000 requests/month'
      }
    };
  }
}
