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

  /**
   * Update conversation embedding if needed (after every 2 messages or every 5 thereafter)
   * This runs asynchronously and doesn't block the response
   * @param {string} conversationId - Conversation ID
   * @param {number} messageCount - Current message count in the conversation
   * @param {string} messageType - Type of message ('rest' or 'live')
   */
  async updateConversationEmbeddingIfNeeded(conversationId, messageCount, messageType = 'rest') {
    // Trigger embedding update:
    // - After first 2 messages (first meaningful exchange)
    // - Then every 5 messages to keep it fresh
    const shouldUpdate = messageCount === 2 || messageCount % 5 === 0;
    
    if (!shouldUpdate) {
      return;
    }

    // Run asynchronously - don't block the response
    setImmediate(async () => {
      try {
        // Dynamic imports to avoid circular dependencies
        const { default: Conversation } = await import('../models/Conversation.js');
        const { default: Message } = await import('../models/Message.js');

        const conversation = await Conversation.findOne({ conversationId });
        if (!conversation) {
          console.warn(`⚠️ Conversation not found for embedding update: ${conversationId}`);
          return;
        }

        // Get recent messages for this conversation
        const messages = await Message.find({ conversationId })
          .sort({ createdAt: -1 })
          .limit(10);

        const searchableContent = this.createSearchableContent(conversation, messages);
        
        if (!searchableContent || searchableContent.trim().length === 0) {
          console.log(`⏭️ No content to embed yet for conversation: ${conversationId}`);
          return;
        }

        const embedding = await this.generateDocumentEmbedding(searchableContent);
        
        await Conversation.updateOne(
          { conversationId },
          { 
            embedding, 
            embeddingUpdatedAt: new Date() 
          }
        );

        console.log(`✅ Auto-updated embedding for ${messageType} conversation: ${conversationId} (${messageCount} messages)`);
      } catch (err) {
        console.error(`⚠️ Failed to update embedding for ${conversationId}:`, err.message);
      }
    });
  }
}

export default new EmbeddingService();
