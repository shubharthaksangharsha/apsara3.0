import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import configurations and services
import DatabaseConfig from './config/database.js';
import ProviderManager from './providers/ProviderManager.js';
import { setupLiveApiServer } from './services/websocket/LiveApiService.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { rateLimiter } from './middleware/rateLimiter.js';

// Import routes
import aiRoutes from './routes/ai.js';
import fileRoutes from './routes/files.js';
import userRoutes from './routes/users.js';
import pluginsRoutes from './routes/tools.js';
import sessionRoutes from './routes/sessions.js';
import googleAuthRoutes from './routes/google-auth.js';
import conversationRoutes from './routes/conversations.js';
import stripeRoutes from './routes/stripe.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ApsaraServer {
  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ 
      server: this.server,
      path: '/live'
    });
    this.port = process.env.PORT || 5000;
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));

    // General middleware
    // Disable compression for Server-Sent Events (SSE) routes to prevent buffering
    this.app.use(compression({
      filter: (req, res) => {
        // Don't compress SSE streams (they need immediate flushing)
        if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
          return false;
        }
        // Use default compression filter for other requests
        return compression.filter(req, res);
      }
    }));
    this.app.use(morgan('combined'));
    
    // Increase body size limits to support large file uploads
    const bodyLimit = process.env.MAX_BODY_SIZE || '100mb';
    this.app.use(express.json({ limit: bodyLimit }));
    this.app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

    // Rate limiting
    this.app.use(rateLimiter);

    // Static files for uploads
    this.app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        database: DatabaseConfig.isConnected() ? 'connected' : 'disconnected'
      });
    });

    // API routes
    this.app.use('/api/ai', aiRoutes);
    this.app.use('/api/files', fileRoutes);
    this.app.use('/api/users', userRoutes);
    this.app.use('/api/tools', pluginsRoutes);
    this.app.use('/api/sessions', sessionRoutes);
    this.app.use('/api/google-auth', googleAuthRoutes);
    this.app.use('/api/auth/google', googleAuthRoutes); // Alias for compatibility
    this.app.use('/api/conversations', conversationRoutes);
    // Stripe payment route (conditionally enabled)
    if (process.env.ENABLE_STRIPE_PAYMENT === 'true') {
      this.app.use('/api/stripe', stripeRoutes);
    }

    // API documentation endpoint
    this.app.get('/api', (req, res) => {
      res.json({
        name: 'Apsara AI Backend',
        version: '1.0.0',
        description: 'Multimodal AI wrapper with Live API support',
        endpoints: {
          '/api/ai': 'AI text generation and multimodal processing',
          '/api/files': 'File upload and management',
          '/api/users': 'User management and authentication',

          '/api/plugins': 'Plugin system and function calling',
          '/api/sessions': 'Session management',
          '/live': 'WebSocket endpoint for Live API'
        }
      });
    });
  }

  async setupWebSocket() {
    await setupLiveApiServer(this.wss);
  }

  setupErrorHandling() {
    // 404 handler
    this.app.use(notFoundHandler);
    
    // Global error handler
    this.app.use(errorHandler);

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
  }

  async start() {
    try {
      // Connect to database
      await DatabaseConfig.connect();

      // Initialize AI providers
      await ProviderManager.initialize();
      
      // Setup WebSocket server
      await this.setupWebSocket();

      // Start server
      this.server.listen(this.port, () => {
        console.log(`🚀 Apsara Backend running on port ${this.port}`);
        console.log(`📡 WebSocket server available at ws://localhost:${this.port}/live`);
        console.log(`🌐 API documentation at http://localhost:${this.port}/api`);
        console.log(`❤️ Health check at http://localhost:${this.port}/health`);
      });

    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }

  async gracefulShutdown(signal) {
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
    
    // Close server
    this.server.close(() => {
      console.log('📡 HTTP server closed');
    });

    // Close WebSocket server
    this.wss.close(() => {
      console.log('🔌 WebSocket server closed');
    });

    // Disconnect from database
    await DatabaseConfig.disconnect();

    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  }
}

// Start the server
const apsaraServer = new ApsaraServer();
apsaraServer.start();