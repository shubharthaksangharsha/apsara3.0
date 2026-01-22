import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

class EmbeddingService {
  constructor() {
    // Check all possible API key environment variable names
    const apiKey = process.env.GEMINI_API_KEY || 
                   process.env.GOOGLE_API_KEY || 
                   process.env.GOOGLE_GEMINI_API_KEY;
    
    if (!apiKey) {
      console.error('❌ No Gemini/Google API key found in environment variables');
      console.error('   Set GEMINI_API_KEY, GOOGLE_API_KEY, or GOOGLE_GEMINI_API_KEY in your .env file');
    } else {
      console.log(`✅ EmbeddingService: Found API key (length: ${apiKey.length})`);
    }
    
    // Initialize with explicit API key - this prevents the library from 
    // trying to use Google Cloud Application Default Credentials
    this.ai = new GoogleGenAI({ apiKey: apiKey });
    this.model = 'gemini-embedding-exp-03-07';
    this.dimensions = 3072; // gemini-embedding-exp-03-07 outputs 3072 dimensions
    this.apiKey = apiKey;
    
    console.log(`✅ EmbeddingService initialized with model: ${this.model}`);
  }

  /**
   * Generate embedding for a single text
   * @param {string} text - Text to embed
   * @param {string} taskType - Task type for optimized embeddings
   * @returns {Promise<number[]>} - Embedding vector
   */
  async generateEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
    try {
      if (!this.apiKey) {
        throw new Error('No API key configured for embedding service');
      }
      
      if (!text || text.trim().length === 0) {
        console.warn('⚠️ Empty text provided for embedding, using placeholder');
        text = 'empty content';
      }

      const response = await this.ai.models.embedContent({
        model: this.model,
        contents: text,
        config: {
          taskType: taskType,
        }
      });

      if (response.embeddings && response.embeddings.length > 0) {
        return response.embeddings[0].values;
      }

      throw new Error('No embeddings returned from API');
    } catch (error) {
      console.error('❌ Error generating embedding:', error.message);
      throw error;
    }
  }

  /**
   * Generate embedding for search query
   * @param {string} query - Search query
   * @returns {Promise<number[]>} - Embedding vector
   */
  async generateQueryEmbedding(query) {
    return this.generateEmbedding(query, 'RETRIEVAL_QUERY');
  }

  /**
   * Generate embedding for document/conversation content
   * @param {string} content - Document content
   * @returns {Promise<number[]>} - Embedding vector
   */
  async generateDocumentEmbedding(content) {
    return this.generateEmbedding(content, 'RETRIEVAL_DOCUMENT');
  }

  /**
   * Generate embeddings for multiple texts in batch
   * @param {string[]} texts - Array of texts to embed
   * @param {string} taskType - Task type for optimized embeddings
   * @returns {Promise<number[][]>} - Array of embedding vectors
   */
  async generateBatchEmbeddings(texts, taskType = 'RETRIEVAL_DOCUMENT') {
    try {
      const embeddings = await Promise.all(
        texts.map(text => this.generateEmbedding(text, taskType))
      );
      return embeddings;
    } catch (error) {
      console.error('❌ Error generating batch embeddings:', error.message);
      throw error;
    }
  }

  /**
   * Create searchable content from conversation
   * @param {Object} conversation - Conversation object
   * @param {Array} messages - Optional messages array
   * @returns {string} - Combined searchable content
   */
  createSearchableContent(conversation, messages = []) {
    const parts = [];
    
    // Add title
    if (conversation.title && conversation.title !== 'New Conversation') {
      parts.push(conversation.title);
    }

    // Add recent messages content (last 10 messages)
    const recentMessages = messages.slice(-10);
    recentMessages.forEach(msg => {
      if (msg.content?.text) {
        parts.push(msg.content.text);
      } else if (typeof msg.content === 'string') {
        parts.push(msg.content);
      }
    });

    // Combine and limit total length to avoid token limits
    const combined = parts.join(' ').trim();
    return combined.substring(0, 5000); // Limit to ~5000 chars
  }
}

export default new EmbeddingService();
