import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

class EmbeddingService {
  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    this.model = 'gemini-embedding-exp-03-07';
    this.dimensions = 768; // Default dimensions for the embedding model
  }

  /**
   * Generate embedding for a single text
   * @param {string} text - Text to embed
   * @param {string} taskType - Task type for optimized embeddings
   * @returns {Promise<number[]>} - Embedding vector
   */
  async generateEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
    try {
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
