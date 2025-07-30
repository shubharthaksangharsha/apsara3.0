import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Test schemas for comprehensive database testing
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  password: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const SessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  provider: { type: String, required: true },
  model: { type: String, required: true },
  status: { type: String, enum: ['active', 'ended'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
  endedAt: { type: Date }
});

const FileSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now }
});

const CacheSchema = new mongoose.Schema({
  cacheId: { type: String, required: true, unique: true },
  content: { type: String, required: true },
  provider: { type: String, required: true },
  model: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

async function testConnection() {
  let User, Session, File, Cache;
  
  try {
    console.log('🚀 Comprehensive MongoDB Database Testing');
    console.log('==========================================\n');
    
    console.log('🔄 Testing MongoDB connection...');
    console.log('URI:', process.env.MONGODB_URI?.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));
    
    // Test with the placeholder replacement (current method)
    const uriWithPassword = process.env.MONGODB_URI?.replace('<db_password>', process.env.DB_PASSWORD);
    console.log('URI with password:', uriWithPassword?.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));
    
    await mongoose.connect(uriWithPassword, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferCommands: false
    });

    console.log('✅ MongoDB connection successful!');
    
    // Create models
    User = mongoose.model('TestUser', UserSchema);
    Session = mongoose.model('TestSession', SessionSchema);
    File = mongoose.model('TestFile', FileSchema);
    Cache = mongoose.model('TestCache', CacheSchema);
    
    console.log('\n📊 Testing Database Operations...');
    
    // Cleanup any existing test data first
    console.log('\n🧹 Cleaning up any existing test data...');
    try {
      await User.deleteMany({ email: { $regex: 'test|transaction' } });
      await Session.deleteMany({ sessionId: { $regex: 'test|transaction' } });
      await File.deleteMany({ filename: { $regex: 'test-file' } });
      await Cache.deleteMany({ cacheId: { $regex: 'cache-' } });
      console.log('✅ Existing test data cleaned up');
    } catch (cleanupError) {
      console.log('⚠️ Cleanup warning:', cleanupError.message);
    }
    
    // Test 1: List collections
    console.log('\n1️⃣ Testing Collection Listing...');
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('📁 Available collections:', collections.map(c => c.name));
    
    // Test 2: User operations
    console.log('\n2️⃣ Testing User Operations...');
    
    // Create a test user
    const testUser = new User({
      email: 'test@apsara.dev',
      name: 'Test User',
      password: 'hashedpassword123',
      isVerified: true
    });
    
    await testUser.save();
    console.log('✅ User created successfully');
    
    // Find the user
    const foundUser = await User.findOne({ email: 'test@apsara.dev' });
    console.log('✅ User found:', foundUser?.name);
    
    // Update the user
    await User.updateOne({ _id: foundUser._id }, { name: 'Updated Test User' });
    console.log('✅ User updated successfully');
    
    // Test 3: Session operations
    console.log('\n3️⃣ Testing Session Operations...');
    
    const testSession = new Session({
      sessionId: 'test-session-' + Date.now(),
      userId: foundUser._id,
      provider: 'google',
      model: 'gemini-2.5-flash',
      status: 'active'
    });
    
    await testSession.save();
    console.log('✅ Session created successfully');
    
    // Find sessions for user
    const userSessions = await Session.find({ userId: foundUser._id });
    console.log('✅ Found', userSessions.length, 'sessions for user');
    
    // Test 4: File operations
    console.log('\n4️⃣ Testing File Operations...');
    
    const testFile = new File({
      filename: 'test-file-' + Date.now() + '.txt',
      originalName: 'test.txt',
      mimeType: 'text/plain',
      size: 1024,
      userId: foundUser._id
    });
    
    await testFile.save();
    console.log('✅ File record created successfully');
    
    // Test 5: Cache operations
    console.log('\n5️⃣ Testing Cache Operations...');
    
    const testCache = new Cache({
      cacheId: 'cache-' + Date.now(),
      content: 'This is cached content for testing',
      provider: 'google',
      model: 'gemini-2.5-flash',
      expiresAt: new Date(Date.now() + 3600000) // 1 hour from now
    });
    
    await testCache.save();
    console.log('✅ Cache entry created successfully');
    
    // Test 6: Complex queries
    console.log('\n6️⃣ Testing Complex Queries...');
    
    // Aggregate query - count documents by collection
    const stats = await Promise.all([
      User.countDocuments(),
      Session.countDocuments(),
      File.countDocuments(),
      Cache.countDocuments()
    ]);
    
    console.log('📈 Database Statistics:');
    console.log('  - Users:', stats[0]);
    console.log('  - Sessions:', stats[1]);
    console.log('  - Files:', stats[2]);
    console.log('  - Cache entries:', stats[3]);
    
    // Test 7: Index operations
    console.log('\n7️⃣ Testing Index Operations...');
    
    const userIndexes = await User.collection.getIndexes();
    console.log('📑 User collection indexes:', Object.keys(userIndexes));
    
    // Test 8: Transaction simulation
    console.log('\n8️⃣ Testing Transaction-like Operations...');
    
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      
      // Create user and session in "transaction"
      const newUser = new User({
        email: 'transaction-test@apsara.dev',
        name: 'Transaction Test User',
        password: 'hashedpassword456'
      });
      
      await newUser.save({ session });
      
      const newSession = new Session({
        sessionId: 'transaction-session-' + Date.now(),
        userId: newUser._id,
        provider: 'google',
        model: 'gemini-2.5-pro'
      });
      
      await newSession.save({ session });
      
      await session.commitTransaction();
      console.log('✅ Transaction-like operations completed successfully');
      
    } catch (error) {
      await session.abortTransaction();
      console.log('❌ Transaction failed:', error.message);
    } finally {
      session.endSession();
    }
    
    // Cleanup test data
    console.log('\n🧹 Cleaning up test data...');
    await User.deleteMany({ email: { $regex: 'test|transaction' } });
    await Session.deleteMany({ sessionId: { $regex: 'test|transaction' } });
    await File.deleteMany({ filename: { $regex: 'test-file' } });
    await Cache.deleteMany({ cacheId: { $regex: 'cache-' } });
    console.log('✅ Test data cleaned up');
    
    // Test 9: Database performance
    console.log('\n9️⃣ Testing Database Performance...');
    
    const startTime = Date.now();
    await Promise.all([
      mongoose.connection.db.admin().ping(),
      User.findOne().limit(1),
      Session.findOne().limit(1)
    ]);
    const endTime = Date.now();
    
    console.log(`⚡ Database response time: ${endTime - startTime}ms`);
    
    // Test 10: Connection health
    console.log('\n🔟 Testing Connection Health...');
    
    const dbStats = await mongoose.connection.db.stats();
    console.log('💾 Database stats:');
    console.log('  - Database name:', dbStats.db);
    console.log('  - Collections:', dbStats.collections);
    console.log('  - Documents:', dbStats.objects);
    console.log('  - Data size:', Math.round(dbStats.dataSize / 1024), 'KB');
    console.log('  - Index size:', Math.round(dbStats.indexSize / 1024), 'KB');
    
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected successfully');
    
    console.log('\n🎉 All database tests completed successfully!');
    console.log('==========================================');
    
  } catch (error) {
    console.error('❌ Database test failed:', error.message);
    
    // Disconnect gracefully
    try {
      await mongoose.disconnect();
    } catch (disconnectError) {
      console.log('⚠️ Disconnect warning:', disconnectError.message);
    }
    
    console.log('\n🔧 Suggestions:');
    console.log('1. Run the test again - temporary data conflicts may have been cleared');
    console.log('2. Check if cluster is active and accessible');
    console.log('3. Verify database permissions');
    
    process.exit(1);
  }
}

testConnection(); 