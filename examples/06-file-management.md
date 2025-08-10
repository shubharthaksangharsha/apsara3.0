# File Management & Multimodal AI Examples

This guide shows how to work with files in the Apsara AI backend, including upload, storage, and AI processing with multimodal capabilities.

## 🎯 Overview

Apsara supports three file storage methods:
- **Local Storage**: Files stored in upload folder (permanent, auto-uploads to Google for AI processing)
- **S3 Storage**: Files stored in AWS S3 bucket (production, manual conversion needed for AI)
- **Google File API**: Direct upload to Google (AI processing optimized, 48h expiry)

### 🧠 Smart Upload System

Apsara now includes an intelligent upload system that automatically selects the optimal storage method based on your preferences:

- **🚀 Speed**: Prioritizes local storage for faster upload/access
- **🧠 Processing**: Optimizes for AI processing using Google File API
- **💾 Storage**: Balances between local and cloud based on file size

### 🔄 Automatic AI Processing

**Local files** are now **automatically compatible** with AI processing! When you upload to local storage and use the file with AI, Apsara automatically uploads a temporary copy to Google File API for processing while keeping your original file in local storage.

## Prerequisites

- Apsara backend running on `http://localhost:5000`
- Valid user account with conversation created
- Files to upload (images, audio, video, documents)

## 1. File Upload Methods

### Smart Upload (Recommended)

The intelligent upload system automatically selects the best storage method based on your preference.

```bash
curl -X POST http://localhost:5000/api/files/smart-upload \
  -H "Content-Type: multipart/form-data" \
  -F "files=@image.jpg" \
  -F "userId=user_123" \
  -F "conversationId=conv_456" \
  -F "aiProvider=google" \
  -F "preference=speed" \
  -F "displayName=Smart Upload Demo"
```

**Preferences:**
- `speed`: Optimizes for fast upload/access (prefers local storage)
- `processing`: Optimizes for AI processing (prefers Google File API)
- `storage`: Balances storage efficiency (size-based routing)

**Response:**
```json
{
  "success": true,
  "storageMethod": "local",
  "files": [
    {
      "fileId": "file_1735123456_abc123def",
      "originalName": "image.jpg",
      "size": 156789,
      "mimeType": "image/jpeg",
      "storageMethod": "local",
      "url": "/api/files/file_1735123456_abc123def/download",
      "smartUploadDecision": {
        "reason": "Speed preference: Using local storage for faster upload/access",
        "preference": "speed",
        "metrics": {
          "totalSize": "0.15MB",
          "fileCount": 1,
          "maxFileSize": "0.15MB"
        }
      }
    }
  ]
}
```

### Local Storage Upload

Best for development and when you need permanent file storage.

```bash
curl -X POST http://localhost:5000/api/files/upload \
  -H "Content-Type: multipart/form-data" \
  -F "files=@image.jpg" \
  -F "storageMethod=local" \
  -F "userId=user_123" \
  -F "conversationId=conv_456" \
  -F "displayName=My Demo Image"
```

**Response:**
```json
{
  "success": true,
  "storageMethod": "local",
  "files": [
    {
      "fileId": "file_1735123456_abc123def",
      "originalName": "image.jpg",
      "size": 156789,
      "mimeType": "image/jpeg",
      "storageMethod": "local",
      "url": "/api/files/file_1735123456_abc123def/download",
      "expiresAt": null
    }
  ]
}
```

### S3 Storage Upload

Best for production environments with scalable storage needs.

```bash
curl -X POST http://localhost:5000/api/files/upload \
  -H "Content-Type: multipart/form-data" \
  -F "files=@document.pdf" \
  -F "storageMethod=s3" \
  -F "userId=user_123" \
  -F "conversationId=conv_456" \
  -F "displayName=Important Document"
```

**Response:**
```json
{
  "success": true,
  "storageMethod": "s3",
  "files": [
    {
      "fileId": "file_1735123456_def456ghi",
      "originalName": "document.pdf",
      "size": 2456789,
      "mimeType": "application/pdf",
      "storageMethod": "s3",
      "url": "https://your-bucket.s3.amazonaws.com/file_1735123456_def456ghi",
      "expiresAt": null
    }
  ]
}
```

### Google File API Upload

Best for AI processing - files are automatically compatible with Google Gemini.

```bash
curl -X POST http://localhost:5000/api/files/upload \
  -H "Content-Type: multipart/form-data" \
  -F "files=@audio.mp3" \
  -F "storageMethod=google-file-api" \
  -F "userId=user_123" \
  -F "conversationId=conv_456" \
  -F "displayName=Voice Recording"
```

**Response:**
```json
{
  "success": true,
  "storageMethod": "google-file-api",
  "files": [
    {
      "fileId": "file_1735123456_ghi789jkl",
      "originalName": "audio.mp3",
      "size": 987654,
      "mimeType": "audio/mpeg",
      "storageMethod": "google-file-api",
      "url": "https://generativelanguage.googleapis.com/v1beta/files/files/xyz789abc",
      "expiresAt": "2024-01-17T15:30:00.000Z"
    }
  ]
}
```

## 2. List User Files

```bash
curl -X GET "http://localhost:5000/api/files?userId=user_123&pageSize=10&page=1" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "success": true,
  "files": [
    {
      "fileId": "file_1735123456_abc123def",
      "originalName": "image.jpg",
      "mimeType": "image/jpeg",
      "size": 156789,
      "type": "image",
      "storage": {
        "provider": "local",
        "url": "/api/files/file_1735123456_abc123def/download"
      },
      "createdAt": "2024-01-15T10:30:00.000Z",
      "isExpired": false
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 5,
    "totalPages": 1
  }
}
```

## 3. AI Generation with Files

### Single File Analysis

```bash
# Works seamlessly with local files - automatic Google upload for AI processing
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "conversationId": "conv_456",
    "contents": "What do you see in this image? Describe it in detail.",
    "files": ["file_1735123456_abc123def"],
    "model": "gemini-2.5-flash",
    "config": {
      "temperature": 0.7,
      "maxOutputTokens": 1024
    }
  }'
```

**Server logs show automatic processing:**
```
🔄 Uploading local file to Google File API for AI processing: file_1735123456_abc123def
✅ Local file temporarily uploaded to Google File API: files/xyz789abc
```

### Multiple Files Analysis

```bash
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "conversationId": "conv_456",
    "contents": "Compare these files and tell me what they have in common.",
    "files": [
      "file_1735123456_abc123def",
      "file_1735123456_def456ghi",
      "gs://bucket/direct-google-file-uri"
    ],
    "model": "gemini-2.5-pro",
    "config": {
      "temperature": 0.5,
      "maxOutputTokens": 2048,
      "thinkingConfig": {
        "includeThoughts": true,
        "thinkingBudget": 1000
      }
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "provider": "google",
  "model": "gemini-2.5-pro",
  "conversationId": "conv_456",
  "text": "I can see several files in your request. The image shows...",
  "thoughts": "Let me analyze each file systematically...",
  "usageMetadata": {
    "promptTokenCount": 150,
    "candidatesTokenCount": 300,
    "totalTokenCount": 450
  },
  "modelMetadata": {
    "temperature": 0.5,
    "maxOutputTokens": 2048
  }
}
```

### Audio Transcription and Analysis

```bash
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "conversationId": "conv_456",
    "contents": "Please transcribe this audio and summarize the main points.",
    "files": ["file_1735123456_ghi789jkl"],
    "model": "gemini-2.5-flash",
    "config": {
      "temperature": 0.3,
      "maxOutputTokens": 1500
    }
  }'
```

### Document Analysis

```bash
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "conversationId": "conv_456",
    "contents": "Extract the key information from this document and create a summary.",
    "files": ["file_1735123456_def456ghi"],
    "model": "gemini-2.5-pro",
    "config": {
      "temperature": 0.2,
      "maxOutputTokens": 2000
    }
  }'
```

## 4. File Management Operations

### Delete a File

```bash
curl -X DELETE "http://localhost:5000/api/files/file_1735123456_abc123def?userId=user_123" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

### Check Supported File Types

```bash
curl -X GET http://localhost:5000/api/files/supported-types \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "success": true,
  "supportedTypes": {
    "images": ["image/jpeg", "image/png", "image/gif", "image/webp"],
    "audio": ["audio/mpeg", "audio/wav", "audio/mp3", "audio/ogg"],
    "video": ["video/mp4", "video/avi", "video/mov", "video/webm"],
    "documents": ["application/pdf", "text/plain", "text/csv"]
  },
  "storageMethods": {
    "local": {
      "description": "Store files in local upload folder",
      "pros": ["Fast access", "No external dependencies"],
      "cons": ["Limited by disk space", "Not scalable across servers"]
    },
    "s3": {
      "description": "Store files in AWS S3 bucket", 
      "pros": ["Scalable", "Reliable", "CDN integration"],
      "cons": ["Requires AWS setup", "Additional cost"]
    },
    "google-file-api": {
      "description": "Upload to Google File API (48h expiry, for AI processing)",
      "pros": ["Integrated with Google AI", "No storage cost"],
      "cons": ["48h expiry", "Processing only", "Cannot download"]
    }
  },
  "maxFileSize": "100MB",
  "maxFilesPerRequest": 10
}
```

## 5. Advanced Use Cases

### Batch Upload with Mixed Storage

```bash
# Upload multiple files with different storage methods
curl -X POST http://localhost:5000/api/files/upload \
  -H "Content-Type: multipart/form-data" \
  -F "files=@image1.jpg" \
  -F "files=@image2.png" \
  -F "files=@document.pdf" \
  -F "storageMethod=google-file-api" \
  -F "userId=user_123" \
  -F "displayName=Batch Upload Demo"
```

### Conversation with File Context

```bash
# First message with file
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "conversationId": "conv_456",
    "contents": "Analyze this image and tell me what business this might be.",
    "files": ["file_1735123456_abc123def"],
    "model": "gemini-2.5-flash"
  }'

# Follow-up message (file context preserved in conversation)
curl -X POST http://localhost:5000/api/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "conversationId": "conv_456",
    "contents": "Based on your previous analysis, what marketing strategies would you recommend?",
    "model": "gemini-2.5-flash"
  }'
```

### File-Based Message Editing

```bash
curl -X POST http://localhost:5000/api/ai/edit-message \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "conversationId": "conv_456",
    "messageId": "msg_789",
    "newContent": "Instead of analyzing the business, tell me about the architectural style of this building.",
    "files": ["file_1735123456_abc123def"],
    "model": "gemini-2.5-flash"
  }'
```

## 6. CLI Tool Integration

### Using the Management CLI

```bash
# Run the management CLI
npm run manage

# Select option 19: Upload file and analyze with AI
# Follow the interactive prompts:
# 1. Select user and conversation
# 2. Enter file path
# 3. Choose storage method (local/google-file-api)
# 4. Select analysis type
# 5. Configure AI parameters
# 6. View results and ask follow-up questions
```

### CLI Example Flow

```
📁 File Upload & AI Analysis
=============================
Enter file path (e.g., ./image.jpg, /path/to/document.pdf): ./demo-image.jpg

📦 Storage Method:
==================
1. Local Storage (permanent, stored on server)
2. Google File API (48h expiry, optimized for AI processing)

Choose storage method (1-2): 2
Enter display name (optional): Demo Image
Enter description (optional): A sample image for testing

📤 Uploading file to google-file-api...
✅ File uploaded successfully!
📁 File ID: file_1735123456_abc123def
📦 Storage: google-file-api
📏 Size: 2.34 MB
🌐 URL: https://generativelanguage.googleapis.com/v1beta/files/files/xyz789abc
⏰ Expires: 1/17/2024, 3:30:00 PM

🤖 AI Analysis Options:
=======================
1. Analyze/describe the file
2. Extract text content
3. Ask custom question about the file
4. Skip AI analysis

Choose analysis option (1-4): 1

⚙️ AI Configuration:
====================
Enter model (default: gemini-2.5-flash): gemini-2.5-pro
Enter temperature 0.0-2.0 (default: 0.7): 0.5
Enter max output tokens (default: 2048): 2048
Enable AI thinking? (y/n, default: y): y
Thinking budget: (1) Dynamic (-1), (2) Off (0), (3) Custom tokens (default: 1): 1
Include thoughts in response? (y/n, default: y): y

🤖 Analyzing file with AI...

✅ AI Analysis Complete!
========================
📁 File: Demo Image
📝 Your Question: Please analyze this file and describe what you see in detail...
🤖 AI Response: I can see a beautiful landscape image showing...
🧠 AI Thoughts: Let me examine the different elements in this image...

📊 Analysis Metadata:
🎯 Tokens Used: 450 (Input: 150, Output: 300)
🌡️ Temperature: 0.5
🤖 Model: gemini-2.5-pro
🏢 Provider: google

💬 Follow-up Options:
Ask another question about this file? (y/n): y
Enter your follow-up question: What colors are dominant in this image?

✅ Follow-up Analysis Complete!
===============================
📝 Follow-up Question: What colors are dominant in this image?
🤖 AI Response: The dominant colors in this image are...
```

## 7. Error Handling

### File Not Found

```json
{
  "success": false,
  "error": "File not found",
  "details": "File with ID 'invalid_file_id' not found for user 'user_123'"
}
```

### File Expired

```json
{
  "success": false,
  "error": "File expired", 
  "details": "File 'file_123' uploaded to Google File API has expired (48h limit)"
}
```

### Unsupported File Type

```json
{
  "success": false,
  "error": "File type not supported",
  "details": "File type 'application/exe' not supported"
}
```

### File Size Limit

```json
{
  "success": false,
  "error": "File too large",
  "details": "File size 150MB exceeds the 100MB limit"
}
```

## 8. Best Practices

### For AI Processing
- **Any storage method works!** Local files automatically upload to Google for AI processing
- Use `google-file-api` for direct upload if you only need AI processing (48h limit)
- Local storage gives you **both** permanent storage AND AI compatibility

### For Production Storage
- Use `s3` storage for permanent, scalable file storage
- S3 files require manual conversion pipeline to Google File API for AI processing
- Set up proper S3 bucket policies and CDN

### For Development  
- **Recommended**: Use `local` storage for seamless development experience
- Files are permanent AND work with AI automatically
- Keep upload folder properly configured and backed up
- Monitor disk space usage

### File Management
- Always include `userId` in file operations for security
- Use descriptive `displayName` for better file organization
- Monitor file expiry dates for Google File API uploads
- Implement cleanup routines for expired files

## 9. Integration Examples

### Frontend File Upload (JavaScript)

```javascript
const uploadFile = async (file, storageMethod = 'google-file-api') => {
  const formData = new FormData();
  formData.append('files', file);
  formData.append('storageMethod', storageMethod);
  formData.append('userId', getCurrentUserId());
  formData.append('displayName', file.name);

  const response = await fetch('/api/files/upload', {
    method: 'POST',
    body: formData
  });

  return response.json();
};

const analyzeWithAI = async (fileId, prompt) => {
  const response = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      userId: getCurrentUserId(),
      conversationId: getCurrentConversationId(),
      contents: prompt,
      files: [fileId],
      model: 'gemini-2.5-flash'
    })
  });

  return response.json();
};
```

### React File Upload Component

```jsx
import React, { useState } from 'react';

const FileUpload = ({ onFileAnalyzed }) => {
  const [file, setFile] = useState(null);
  const [storageMethod, setStorageMethod] = useState('google-file-api');
  const [analyzing, setAnalyzing] = useState(false);

  const handleUploadAndAnalyze = async () => {
    if (!file) return;

    setAnalyzing(true);
    try {
      // Upload file
      const uploadResult = await uploadFile(file, storageMethod);
      
      if (uploadResult.success) {
        // Analyze with AI
        const analysisResult = await analyzeWithAI(
          uploadResult.files[0].fileId,
          'Please analyze this file and describe what you see.'
        );
        
        onFileAnalyzed(uploadResult.files[0], analysisResult);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="file-upload">
      <input
        type="file"
        onChange={(e) => setFile(e.target.files[0])}
        accept="image/*,audio/*,video/*,.pdf,.txt,.csv"
      />
      
      <select
        value={storageMethod}
        onChange={(e) => setStorageMethod(e.target.value)}
      >
        <option value="google-file-api">Google File API (AI Processing)</option>
        <option value="local">Local Storage</option>
        <option value="s3">S3 Storage</option>
      </select>
      
      <button
        onClick={handleUploadAndAnalyze}
        disabled={!file || analyzing}
      >
        {analyzing ? 'Analyzing...' : 'Upload & Analyze'}
      </button>
    </div>
  );
};
```

## 10. Performance Optimization

### File Upload Optimization
- Use appropriate storage method based on use case
- Implement client-side file validation
- Add progress indicators for large file uploads
- Implement retry logic for failed uploads

### AI Processing Optimization
- Use Google File API for AI processing when possible
- Batch similar file analysis requests
- Implement caching for repeated analysis
- Use appropriate model based on file type and complexity

### Storage Optimization
- Implement automatic cleanup for expired files
- Use CDN for frequently accessed files
- Compress images and documents when appropriate
- Monitor storage usage and costs

This comprehensive guide covers all aspects of file management in the Apsara AI backend, from basic uploads to advanced multimodal AI interactions. For Live API audio management, see the [Live API Management Guide](07-live-api-management.md). 