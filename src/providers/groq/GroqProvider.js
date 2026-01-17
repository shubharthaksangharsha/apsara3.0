import Groq from 'groq-sdk';
import { BaseProvider } from '../base/BaseProvider.js';

/**
 * Groq Provider
 * Ultra-fast LLM inference for chat title generation
 * Uses llama-3.1-8b-instant for sub-second responses
 */
export class GroqProvider extends BaseProvider {
  constructor() {
    super('groq');
    this.client = null;
    this.defaultModel = 'llama-3.1-8b-instant'; // Fastest model for short tasks
    this.isInitialized = false;
    this.hasApiKey = false;
  }

  /**
   * Initialize the Groq provider
   */
  async initialize() {
    try {
      const apiKey = process.env.groq;
      
      if (apiKey) {
        this.client = new Groq({
          apiKey: apiKey
        });
        this.hasApiKey = true;
        console.log('✅ Groq Provider initialized with API key');
      } else {
        this.hasApiKey = false;
        console.log('⚠️  Groq Provider initialized without API key');
        console.log('💡 Add groq to .env for AI-powered titles');
      }
      
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Groq Provider:', error);
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
      throw new Error('GroqProvider is not initialized');
    }

    const {
      maxTokens = 10, // Very short output for titles
      temperature = 0.2, // Low temperature for consistent, focused titles
      model = this.defaultModel,
      useAI = true // Try AI by default (Groq is fast enough)
    } = options;

    // If no API key, use fallback immediately
    if (!this.hasApiKey || !useAI) {
      console.log('🎯 Using smart extraction for title (no Groq API key)...');
      const fallbackTitle = this._createFallbackTitle(conversationText);
      return {
        success: true,
        title: fallbackTitle,
        provider: 'groq',
        method: 'smart-extraction',
        cost: 'FREE'
      };
    }

    try {
      console.log('🤖 Generating chat title with Groq AI...');
      console.log(`📝 Model: ${model}`);
      console.log(`📏 Conversation length: ${conversationText.length} characters`);

      // Prepare conversation text (limit to 1000 chars for safety - approx 250 tokens)
      // This ensures we stay well within token limits while capturing enough context
      const maxChars = 1000;
      let inputText = conversationText;
      if (conversationText.length > maxChars) {
        inputText = conversationText.substring(0, maxChars) + '...';
        console.log(`⚠️  Truncated conversation to ${maxChars} characters`);
      }

      // Create the prompt for title generation
      const prompt = `Create a short chat title (max 6 words) summarizing this conversation.
Do not add quotes.
Do not add explanation.
Only output the title.

Conversation:
${inputText}`;

      console.log('⏳ Calling Groq API...');
      const startTime = Date.now();

      // Add timeout wrapper (5 seconds for Groq - it's very fast)
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout after 5 seconds')), 5000)
      );

      const completionPromise = this.client.chat.completions.create({
        model: model,
        messages: [
          { 
            role: 'system', 
            content: 'You generate short, concise chat titles (max 6 words). No quotes. No explanation. Just the title.' 
          },
          { 
            role: 'user', 
            content: prompt 
          }
        ],
        temperature: temperature,
        max_tokens: maxTokens,
        top_p: 1,
        stream: false
      });

      const completion = await Promise.race([completionPromise, timeoutPromise]);
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      // Extract and clean the title
      let title = completion.choices[0].message.content.trim();
      title = this._cleanTitle(title);

      console.log(`✅ Generated title in ${responseTime}ms: "${title}"`);

      // Calculate token usage and cost
      const usage = completion.usage;
      const estimatedCost = this._calculateCost(usage);

      return {
        success: true,
        title,
        model: model,
        provider: 'groq',
        method: 'ai-generation',
        responseTime: `${responseTime}ms`,
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        },
        cost: estimatedCost
      };
    } catch (error) {
      console.error('❌ Groq title generation error:', error.message);
      
      // Fallback: extract from first line
      const fallbackTitle = this._createFallbackTitle(conversationText);
      
      return {
        success: false,
        title: fallbackTitle,
        error: error.message,
        provider: 'groq',
        method: 'fallback',
        cost: 'FREE'
      };
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
      .replace(/\.$/, '') // Remove trailing period
      .trim();

    // Limit to 6 words maximum
    const words = title.split(/\s+/);
    if (words.length > 6) {
      title = words.slice(0, 6).join(' ');
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
   * Calculate estimated cost for API usage
   * @private
   */
  _calculateCost(usage) {
    // Groq pricing (as of 2024):
    // llama-3.1-8b-instant: $0.05 per 1M input tokens, $0.08 per 1M output tokens
    const inputCostPer1M = 0.05;
    const outputCostPer1M = 0.08;
    
    const inputCost = (usage.prompt_tokens / 1000000) * inputCostPer1M;
    const outputCost = (usage.completion_tokens / 1000000) * outputCostPer1M;
    const totalCost = inputCost + outputCost;
    
    if (totalCost < 0.0001) {
      return 'FREE (< $0.0001)';
    }
    
    return `$${totalCost.toFixed(6)}`;
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

      if (!this.hasApiKey) {
        return {
          status: 'warning',
          message: 'No API key configured (using fallback mode)',
          fallbackAvailable: true
        };
      }

      // Quick test with Groq
      const testCompletion = await this.client.chat.completions.create({
        model: this.defaultModel,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Say OK' }
        ],
        max_tokens: 5
      });

      return {
        status: 'healthy',
        provider: 'groq',
        model: this.defaultModel,
        test: testCompletion.choices[0].message.content
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        fallbackAvailable: true
      };
    }
  }

  /**
   * Get provider capabilities
   */
  getCapabilities() {
    return {
      provider: 'groq',
      capabilities: [
        'chat-title-generation',
        'text-completion',
        'ultra-fast-inference'
      ],
      models: {
        titleGeneration: this.defaultModel,
        available: [
          'llama-3.1-8b-instant',
          'llama-3.1-70b-versatile',
          'mixtral-8x7b-32768'
        ]
      },
      performance: {
        typicalResponseTime: '200-500ms',
        maxResponseTime: '5000ms (timeout)'
      },
      pricing: {
        model: this.defaultModel,
        inputCost: '$0.05 per 1M tokens',
        outputCost: '$0.08 per 1M tokens',
        titleCostEstimate: '< $0.0001 per title'
      },
      rateLimits: {
        free: '30 requests/minute',
        paid: '60 requests/minute'
      }
    };
  }

  /**
   * Get supported models for this provider
   * Required by ProviderManager to route models to correct provider
   */
  getSupportedModels() {
    return {
      rest: [
        'llama-3.1-8b-instant',
        'llama-3.3-70b-versatile',
        'openai/gpt-oss-20b',
        'openai/gpt-oss-120b',
        'groq/compound',
        'groq/compound-mini',
        'qwen/qwen3-32b',
        'moonshotai/kimi-k2-instruct-0905'
      ],
      live: [], // Groq doesn't support live API
      embeddings: [] // Groq doesn't support embeddings yet
    };
  }

  /**
   * Generate a chat completion (general purpose)
   */
  async generateCompletion(messages, options = {}) {
    if (!this.isInitialized || !this.hasApiKey) {
      throw new Error('Groq API key not configured');
    }

    const {
      model = this.defaultModel,
      temperature = 0.7,
      maxTokens = 1024
    } = options;

    const completion = await this.client.chat.completions.create({
      model: model,
      messages: messages,
      temperature: temperature,
      max_tokens: maxTokens
    });

    return {
      success: true,
      content: completion.choices[0].message.content,
      usage: completion.usage,
      model: model
    };
  }

  /**
   * Generate streaming content (required by ProviderManager)
   * @param {Object} params - Generation parameters
   * @returns {AsyncGenerator} Streaming response chunks
   */
  async *generateContentStream(params) {
    if (!this.isInitialized || !this.hasApiKey) {
      throw new Error('Groq API key not configured');
    }

    const { contents, config } = params;
    const {
      model = this.defaultModel,
      temperature = 0.7,
      maxOutputTokens = 2048,
      topP = 1,
      thinkingConfig = null
    } = config;

    // Convert Gemini-style contents to OpenAI-style messages
    const messages = this._convertContentsToMessages(contents);

    // Prepare request options
    const requestOptions = {
      model: model,
      messages: messages,
      temperature: temperature,
      max_completion_tokens: maxOutputTokens, // Groq uses max_completion_tokens
      top_p: topP,
      stream: true
    };

    // Add reasoning parameters for reasoning models (following Groq docs)
    if (thinkingConfig && (thinkingConfig.thinkingBudget > 0 || thinkingConfig.thinkingBudget === -1)) {
      // GPT-OSS models: use include_reasoning and reasoning_effort
      if (model.includes('gpt-oss')) {
        requestOptions.include_reasoning = true;
        
        // Map thinking budget to reasoning effort
        if (thinkingConfig.thinkingBudget === -1) {
          requestOptions.reasoning_effort = 'medium'; // Default for AUTO mode
        } else if (thinkingConfig.thinkingBudget >= 10000) {
          requestOptions.reasoning_effort = 'high';
        } else if (thinkingConfig.thinkingBudget >= 5000) {
          requestOptions.reasoning_effort = 'medium';
        } else {
          requestOptions.reasoning_effort = 'low';
        }
      }
      // Qwen models: use reasoning_format and reasoning_effort
      else if (model.includes('qwen')) {
        requestOptions.reasoning_format = 'raw'; // Include <think> tags in content
        requestOptions.reasoning_effort = 'default'; // Enable reasoning
      }
    } else {
      // Disable reasoning when not requested (budget is 0 or undefined)
      if (model.includes('gpt-oss')) {
        requestOptions.include_reasoning = false;
      } else if (model.includes('qwen')) {
        requestOptions.reasoning_effort = 'none';
      }
    }

    try {
      const stream = await this.client.chat.completions.create(requestOptions);
      
      let fullThoughts = '';
      let isInThinkingBlock = false;
      
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        let chunkText = delta.content || '';
        let chunkThought = '';

        // Handle reasoning from GPT-OSS models (comes in delta.reasoning field)
        if (delta.reasoning) {
          chunkThought = delta.reasoning;
          fullThoughts += chunkThought;
        }

        // Handle Qwen <think> tags (embedded in content when reasoning_format=raw)
        if (model.includes('qwen') && chunkText) {
          // Extract thinking content from <think> tags
          const thinkMatches = chunkText.match(/<think>([\s\S]*?)<\/think>/g);
          if (thinkMatches) {
            for (const match of thinkMatches) {
              const thinking = match.replace(/<think>|<\/think>/g, '');
              chunkThought += thinking;
              fullThoughts += thinking;
            }
            // Remove <think> tags from main content
            chunkText = chunkText.replace(/<think>[\s\S]*?<\/think>/g, '');
          }
        }

        yield {
          success: true,
          text: chunkText,
          thought: chunkThought || null,
          isThinking: !!chunkThought,
          hasThoughtSignatures: fullThoughts.length > 0,
          isEndChunk: chunk.choices[0]?.finish_reason !== null,
          usageMetadata: chunk.usage ? {
            promptTokenCount: chunk.usage.prompt_tokens || 0,
            candidatesTokenCount: chunk.usage.completion_tokens || 0,
            totalTokenCount: chunk.usage.total_tokens || 0
          } : null,
          finishReason: chunk.choices[0]?.finish_reason || null
        };
      }
    } catch (error) {
      console.error('❌ Groq streaming error:', error);
      throw error;
    }
  }

  /**
   * Convert Gemini-style contents to OpenAI-style messages
   * @private
   */
  _convertContentsToMessages(contents) {
    const messages = [];
    
    for (const content of contents) {
      const message = {
        role: content.role === 'model' ? 'assistant' : content.role,
        content: ''
      };

      // Extract text from parts
      if (Array.isArray(content.parts)) {
        const textParts = content.parts
          .filter(part => part.text)
          .map(part => part.text)
          .join('\n');
        message.content = textParts;
      } else if (typeof content.parts === 'string') {
        message.content = content.parts;
      }

      if (message.content) {
        messages.push(message);
      }
    }

    return messages;
  }
}
