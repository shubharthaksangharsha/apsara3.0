# Apsara AI Frontend

A modern, responsive Flask web application that provides a complete user interface for the Apsara AI backend system.

## Features

### 🔐 Authentication System
- **Traditional Registration** with OTP email verification
- **Login** with email and password
- **Guest Login** for trial access (5 free messages)
- **Password visibility toggle** and validation
- **Session management** with automatic redirects

### 💬 Chat Interface
- **Conversation Management** - Create, view, and organize conversations
- **System Instructions** - Define AI behavior for each conversation
- **Real-time Messaging** with conversation history
- **Typing Indicators** and message status
- **Message Timestamps** and metadata display

### 📎 File Management
- **Drag & Drop File Upload** with multiple file support
- **File Preview System** with thumbnails and details
- **Multiple Storage Methods** (local, S3, Google File API)
- **File Type Validation** and size limits
- **Remove/Clear Files** functionality

### ⚙️ AI Configuration Panel
- **Model Selection** (Gemini 2.5 Flash/Pro)
- **Temperature Control** with visual slider
- **Token Limits** configuration
- **AI Thinking Mode** with budget controls
- **Real-time Settings** that apply to each message

### 📱 Responsive Design
- **Mobile-First** approach with collapsible sidebar
- **Bootstrap 5** with custom styling
- **Dark Mode Ready** (future enhancement)
- **Touch-Friendly** interfaces
- **Progressive Enhancement**

## Installation

### Prerequisites
- Python 3.8+
- Running Apsara AI Backend on `http://localhost:5000`
- Modern web browser

### Setup

1. **Clone and Navigate**
   ```bash
   cd frontend
   ```

2. **Create Virtual Environment**
   ```bash
   python -m venv venv
   
   # Windows
   venv\Scripts\activate
   
   # macOS/Linux
   source venv/bin/activate
   ```

3. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure Environment**
   ```bash
   # Create .env file (optional)
   FLASK_ENV=development
   FLASK_DEBUG=True
   SECRET_KEY=your-secret-key-here
   BACKEND_URL=http://localhost:5000/api
   ```

5. **Run Application**
   ```bash
   python app.py
   ```

6. **Access Application**
   Open `http://localhost:3000` in your browser

## Project Structure

```
frontend/
├── app.py                 # Main Flask application
├── requirements.txt       # Python dependencies
├── README.md             # This file
├── templates/            # Jinja2 templates
│   ├── base.html         # Base template with navigation
│   ├── index.html        # Landing page
│   ├── dashboard.html    # User dashboard
│   ├── conversation.html # Chat interface
│   └── auth/            # Authentication templates
│       ├── register.html # Registration with OTP
│       └── login.html    # Login page
└── static/              # Static assets
    ├── css/
    │   └── style.css     # Custom styles
    ├── js/
    │   └── app.js        # Frontend JavaScript
    └── uploads/          # Temporary file uploads
```

## API Integration

The frontend integrates with the Apsara AI backend using these endpoints:

### Authentication
- `POST /api/users/register` - User registration
- `POST /api/users/verify-email` - Email OTP verification  
- `POST /api/users/login` - User login
- `POST /api/users/guest-login` - Guest session creation

### Conversations
- `GET /api/conversations` - List user conversations
- `POST /api/conversations` - Create new conversation
- `GET /api/conversations/:id/messages` - Get conversation messages

### AI Generation
- `POST /api/ai/generate` - Send message to AI with history

### File Management
- `POST /api/files/upload` - Upload files with multiple storage options
- `DELETE /api/files/:id` - Delete uploaded files

## Usage Guide

### Getting Started

1. **Visit Homepage** (`http://localhost:3000`)
   - Try guest login for immediate access
   - Or register/login for full features

2. **Create Conversation**
   - Click "New Conversation" 
   - Set a descriptive title
   - Add system instruction (optional)
   - Choose from quick examples

3. **Configure AI Settings**
   - Use sidebar to adjust model, temperature
   - Enable/configure AI thinking mode
   - Set token limits

4. **Chat with AI**
   - Type messages in the input field
   - Attach files using the paperclip button
   - View AI responses with thinking process
   - See token usage and metadata

### File Upload Workflow

1. **Click the Paperclip Button** or drag files to the chat
2. **Select Files** - supports images, documents, audio, video
3. **Choose Storage Method** (handled automatically)
4. **Preview Files** before sending
5. **Send Message** - AI will analyze attached files
6. **Remove Files** if needed before sending

### Advanced Features

- **Keyboard Shortcuts**: Enter to send, Shift+Enter for newline
- **Auto-Save Settings**: Preferences are remembered
- **Mobile Support**: Full functionality on all devices
- **Error Handling**: Graceful degradation and user feedback

## Configuration

### Backend URL
Update `BACKEND_URL` in `app.py` if your backend runs on a different port:
```python
BACKEND_URL = 'http://localhost:5000/api'
```

### File Upload Limits
Modify allowed file types and sizes in `app.py`:
```python
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'mp3', 'mp4', 'wav', 'ogg'}
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
```

### Authentication
Set a secure secret key for production:
```python
app.secret_key = 'your-secure-secret-key-here'
```

## Development

### Adding New Features

1. **Backend Integration**: Add new API endpoints in `app.py`
2. **Frontend Logic**: Extend JavaScript in `static/js/app.js`
3. **UI Components**: Create new templates or modify existing ones
4. **Styling**: Add CSS to `static/css/style.css`

### Debugging

- Enable Flask debug mode: `FLASK_DEBUG=True`
- Check browser console for JavaScript errors
- Monitor Flask logs for backend communication issues
- Use browser dev tools for network request inspection

## Production Deployment

### Security Considerations
- Set strong `SECRET_KEY`
- Use HTTPS in production
- Configure proper CORS headers
- Implement rate limiting
- Add CSRF protection

### Performance Optimization
- Enable gzip compression
- Use CDN for static assets
- Implement caching headers
- Optimize images and files
- Monitor memory usage

### Recommended Stack
- **Web Server**: Nginx or Apache
- **WSGI Server**: Gunicorn or uWSGI
- **SSL/TLS**: Let's Encrypt or commercial certificate
- **Monitoring**: Application monitoring and logging

## Troubleshooting

### Common Issues

**Backend Connection Failed**
- Ensure Apsara backend is running on port 5000
- Check firewall and network connectivity
- Verify API endpoints are accessible

**File Upload Errors**
- Check file size limits and types
- Ensure upload directory is writable
- Verify storage method configuration

**Authentication Issues**
- Clear browser session/cookies
- Check backend user authentication
- Verify JWT token handling

**Mobile Responsiveness**
- Test on actual devices
- Check viewport meta tag
- Verify touch event handling

### Getting Help

1. Check browser developer console for errors
2. Review Flask application logs
3. Verify backend API responses
4. Test with different browsers and devices

## License

This frontend application is part of the Apsara AI project and follows the same licensing terms as the main project.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

For major changes, please open an issue first to discuss what you would like to change.