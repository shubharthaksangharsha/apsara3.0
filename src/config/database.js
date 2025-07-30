import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

class DatabaseConfig {
  constructor() {
    this.connectionString = process.env.MONGODB_URI?.replace('<db_password>', process.env.DB_PASSWORD);
    this.options = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferCommands: false
    };
  }

  async connect() {
    try {
      await mongoose.connect(this.connectionString, this.options);
      console.log('✅ Connected to MongoDB Atlas');
      
      // Set up connection event listeners
      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️ MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        console.log('🔄 MongoDB reconnected');
      });

    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error.message);
      process.exit(1);
    }
  }

  async disconnect() {
    try {
      await mongoose.disconnect();
      console.log('🔌 Disconnected from MongoDB');
    } catch (error) {
      console.error('❌ Error disconnecting from MongoDB:', error.message);
    }
  }

  isConnected() {
    return mongoose.connection.readyState === 1;
  }

  getConnection() {
    return mongoose.connection;
  }
}

export default new DatabaseConfig(); 