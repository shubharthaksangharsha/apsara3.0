#!/usr/bin/env python3

import os
import json
import requests
from datetime import datetime
from flask import Flask, request, jsonify, render_template, session, redirect, url_for, flash, Response
from werkzeug.utils import secure_filename
import uuid

app = Flask(__name__)
app.secret_key = 'your-secret-key-change-in-production'

# Configuration
# BACKEND_URL = 'http://localhost:5000/api'
BACKEND_URL = 'https://apsara-backend.devshubh.me/api'
UPLOAD_FOLDER = 'static/uploads'
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'mp3', 'mp4', 'wav', 'ogg'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Ensure upload directory exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def make_backend_request(endpoint, method='GET', data=None, files=None, token=None):
    """Make requests to the backend API"""
    url = f"{BACKEND_URL}/{endpoint.lstrip('/')}"
    headers = {'Content-Type': 'application/json'}
    
    if token:
        headers['Authorization'] = f'Bearer {token}'
    
    try:
        if method == 'GET':
            response = requests.get(url, headers=headers)
        elif method == 'POST':
            if files:
                # For file uploads, don't set Content-Type header
                headers.pop('Content-Type', None)
                response = requests.post(url, data=data, files=files, headers=headers)
            else:
                response = requests.post(url, json=data, headers=headers)
        elif method == 'PUT':
            response = requests.put(url, json=data, headers=headers)
        elif method == 'DELETE':
            response = requests.delete(url, headers=headers)
        
        # Handle HTTP error codes
        if response.status_code >= 400:
            try:
                error_data = response.json()
                error_msg = error_data.get('error', error_data.get('message', f'HTTP {response.status_code} error'))
                return {'success': False, 'error': error_msg, 'status_code': response.status_code}
            except:
                return {'success': False, 'error': f'HTTP {response.status_code} error', 'status_code': response.status_code}
        
        return response.json()
    except requests.exceptions.RequestException as e:
        return {'success': False, 'error': f'Network error: {str(e)}'}

@app.route('/')
def index():
    """Home page - redirect based on authentication status"""
    if 'user' in session:
        return redirect(url_for('dashboard'))
    return render_template('index.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    """User registration with OTP verification"""
    if request.method == 'POST':
        data = request.get_json()
        
        # Step 1: Register user
        if data.get('step') == 'register':
            register_data = {
                'fullName': data['fullName'],
                'email': data['email'],
                'password': data['password'],
                'acceptTerms': True
            }
            
            result = make_backend_request('users/register', 'POST', register_data)
            
            if result.get('success'):
                session['pending_email'] = data['email']
                return jsonify({'success': True, 'message': 'OTP sent to your email'})
            else:
                return jsonify({'success': False, 'error': result.get('error', 'Registration failed')})
        
        # Step 2: Verify OTP
        elif data.get('step') == 'verify':
            verify_data = {
                'email': session.get('pending_email'),
                'otp': data['otp']
            }
            
            result = make_backend_request('users/verify-email', 'POST', verify_data)
            
            if result.get('success'):
                session.pop('pending_email', None)
                return jsonify({'success': True, 'message': 'Registration completed successfully!'})
            else:
                return jsonify({'success': False, 'error': result.get('error', 'OTP verification failed')})
    
    return render_template('auth/register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    """User login"""
    if request.method == 'POST':
        data = request.get_json()
        
        login_data = {
            'email': data['email'],
            'password': data['password']
        }
        
        result = make_backend_request('users/login', 'POST', login_data)
        
        if result.get('success'):
            user_data = result['data']['user']
            session['user'] = user_data
            session['token'] = result['data']['token']
            return jsonify({'success': True, 'redirect': url_for('dashboard')})
        else:
            return jsonify({'success': False, 'error': result.get('error', 'Login failed')})
    
    return render_template('auth/login.html')

@app.route('/guest-login', methods=['POST'])
def guest_login():
    """Guest login for trial access"""
    result = make_backend_request('users/guest-login', 'POST', {})
    
    if result.get('success'):
        user_data = result['data']['user']
        session['user'] = user_data
        session['token'] = result['data']['token']
        session['guest_limitations'] = result['data']['limitations']
        return jsonify({'success': True, 'redirect': url_for('dashboard')})
    else:
        return jsonify({'success': False, 'error': result.get('error', 'Guest login failed')})

@app.route('/logout')
def logout():
    """User logout"""
    session.clear()
    flash('You have been logged out successfully', 'info')
    return redirect(url_for('index'))

@app.route('/dashboard')
def dashboard():
    """Main dashboard with conversations"""
    if 'user' not in session:
        return redirect(url_for('index'))
    
    # Get user's conversations
    token = session.get('token')
    user_id = session['user']['id']
    
    # Try to get conversations, but handle if endpoint doesn't exist yet
    conversations = []
    try:
        conversations_result = make_backend_request(f'conversations/{user_id}?limit=20', 'GET', token=token)
        if conversations_result.get('success'):
            # Backend returns conversations in data field as an array
            conversations = conversations_result.get('data', [])
            
            # Convert string timestamps to datetime objects for template compatibility
            from datetime import datetime
            for conversation in conversations:
                if conversation.get('createdAt') and isinstance(conversation['createdAt'], str):
                    try:
                        conversation['createdAt'] = datetime.fromisoformat(conversation['createdAt'].replace('Z', '+00:00'))
                    except:
                        conversation['createdAt'] = None
                if conversation.get('updatedAt') and isinstance(conversation['updatedAt'], str):
                    try:
                        conversation['updatedAt'] = datetime.fromisoformat(conversation['updatedAt'].replace('Z', '+00:00'))
                    except:
                        conversation['updatedAt'] = None
        else:
            print(f"Failed to fetch conversations: {conversations_result.get('error')}")
    except Exception as e:
        print(f"Error fetching conversations: {e}")
    
    return render_template('dashboard.html', 
                         user=session['user'], 
                         conversations=conversations,
                         guest_limitations=session.get('guest_limitations'))

@app.route('/conversation/<conversation_id>')
def conversation_view(conversation_id):
    """View specific conversation"""
    if 'user' not in session:
        return redirect(url_for('index'))
    
    token = session.get('token')
    user_id = session['user']['id']
    
    # Get conversation details by finding it in user's conversations
    conversations_result = make_backend_request(f'conversations/{user_id}', 'GET', token=token)
    conversation = None
    
    if conversations_result.get('success'):
        conversations = conversations_result.get('data', [])
        conversation = next((c for c in conversations if c.get('conversationId') == conversation_id), None)
    
    if not conversation:
        flash('Conversation not found', 'error')
        return redirect(url_for('dashboard'))
    
    # Get conversation messages
    messages_result = make_backend_request(f'conversations/{conversation_id}/messages', 'GET', token=token)
    messages = messages_result.get('data', []) if messages_result.get('success') else []
    
    # Convert string timestamps to datetime objects for template compatibility
    from datetime import datetime
    for message in messages:
        if message.get('createdAt') and isinstance(message['createdAt'], str):
            try:
                message['createdAt'] = datetime.fromisoformat(message['createdAt'].replace('Z', '+00:00'))
            except:
                message['createdAt'] = None
        if message.get('updatedAt') and isinstance(message['updatedAt'], str):
            try:
                message['updatedAt'] = datetime.fromisoformat(message['updatedAt'].replace('Z', '+00:00'))
            except:
                message['updatedAt'] = None
    
    # Also convert conversation timestamps
    if conversation.get('createdAt') and isinstance(conversation['createdAt'], str):
        try:
            conversation['createdAt'] = datetime.fromisoformat(conversation['createdAt'].replace('Z', '+00:00'))
        except:
            conversation['createdAt'] = None
    if conversation.get('updatedAt') and isinstance(conversation['updatedAt'], str):
        try:
            conversation['updatedAt'] = datetime.fromisoformat(conversation['updatedAt'].replace('Z', '+00:00'))
        except:
            conversation['updatedAt'] = None
    
    return render_template('conversation.html', 
                         user=session['user'],
                         conversation=conversation,
                         messages=messages,
                         guest_limitations=session.get('guest_limitations'))

@app.route('/api/create-conversation', methods=['POST'])
def create_conversation():
    """Create a new conversation"""
    if 'user' not in session:
        return jsonify({'success': False, 'error': 'Not authenticated'})
    
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data provided'})
    
    token = session.get('token')
    
    # Ensure we have required fields
    title = data.get('title', '').strip()
    if not title:
        return jsonify({'success': False, 'error': 'Title is required'})
    
    # Build config object
    config = {
        'model': 'gemini-2.5-flash',
        'temperature': 0.7,
        'maxOutputTokens': 2048
    }
    
    # Only add systemInstruction if it's not empty
    system_instruction = data.get('systemInstruction', '').strip()
    if system_instruction:
        config['systemInstruction'] = system_instruction
    
    conversation_data = {
        'userId': session['user']['id'],
        'title': title,
        'config': config
    }
    
    # Add debug logging
    print(f"Creating conversation with data: {conversation_data}")
    
    result = make_backend_request('conversations', 'POST', conversation_data, token=token)
    
    print(f"Backend response: {result}")
    
    if result.get('success'):
        # Backend returns conversation data directly in data field
        conversation_data = result.get('data', {})
        conversation_id = conversation_data.get('conversationId')
        
        if conversation_id:
            return jsonify({'success': True, 'conversationId': conversation_id})
        else:
            return jsonify({'success': False, 'error': 'No conversation ID returned from backend'})
    else:
        error_msg = result.get('error', 'Failed to create conversation')
        print(f"Conversation creation failed: {error_msg}")
        return jsonify({'success': False, 'error': error_msg})

@app.route('/api/upload-file', methods=['POST'])
def upload_file():
    """Upload file for AI processing"""
    if 'user' not in session:
        return jsonify({'success': False, 'error': 'Not authenticated'})
    
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'})
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'})
    
    if not allowed_file(file.filename):
        return jsonify({'success': False, 'error': 'File type not allowed'})
    
    # Save file temporarily for upload to backend
    filename = secure_filename(file.filename)
    temp_filename = f"{uuid.uuid4()}_{filename}"
    temp_path = os.path.join(app.config['UPLOAD_FOLDER'], temp_filename)
    file.save(temp_path)
    
    try:
        # Upload to backend
        storage_method = request.form.get('storageMethod', 'google-file-api')
        user_id = session['user']['id']
        conversation_id = request.form.get('conversationId', '')
        
        with open(temp_path, 'rb') as f:
            files = {'files': (filename, f, file.content_type)}
            data = {
                'storageMethod': storage_method,
                'userId': user_id,
                'conversationId': conversation_id,
                'displayName': filename
            }
            
            result = make_backend_request('files/upload', 'POST', data=data, files=files)
        
        # Clean up temp file
        os.remove(temp_path)
        
        if result.get('success'):
            uploaded_file = result['files'][0]
            return jsonify({
                'success': True,
                'file': {
                    'id': uploaded_file['fileId'],
                    'name': uploaded_file['originalName'],
                    'size': uploaded_file['size'],
                    'type': uploaded_file['mimeType']
                }
            })
        else:
            return jsonify({'success': False, 'error': result.get('error', 'Upload failed')})
    
    except Exception as e:
        # Clean up temp file on error
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/send-message', methods=['POST'])
def send_message():
    """Send message to AI with optional files"""
    if 'user' not in session:
        return jsonify({'success': False, 'error': 'Not authenticated'})
    
    data = request.get_json()
    token = session.get('token')
    
    message_data = {
        'userId': session['user']['id'],
        'conversationId': data['conversationId'],
        'contents': data['message'],
        'model': data.get('model', 'gemini-2.5-flash'),
        'stream': data.get('stream', False),  # Support streaming
        'config': {
            'temperature': float(data.get('temperature', 0.7)),
            'maxOutputTokens': int(data.get('maxTokens', 2048)),
            'thinkingConfig': {
                'includeThoughts': data.get('includeThoughts', True),
                'thinkingBudget': int(data.get('thinkingBudget', -1))
            }
        }
    }
    
    # Add files if provided
    if data.get('files'):
        message_data['files'] = data['files']
    
    result = make_backend_request('ai/generate', 'POST', message_data, token=token)
    
    if result.get('success'):
        # Update guest limitations if user is a guest and backend provides usage info
        if session['user']['role'] == 'guest' and result.get('usageInfo'):
            guest_usage_info = result['usageInfo'].get('guestLimits', {})
            if guest_usage_info:
                # Update session with new guest limitations
                session['guest_limitations'] = {
                    'totalMessagesLimit': guest_usage_info.get('totalMessages', 5),
                    'totalMessagesUsed': guest_usage_info.get('totalMessagesUsed', 0),
                    'remainingMessages': guest_usage_info.get('remainingMessages', 5)
                }
                session.modified = True
        
        return jsonify({
            'success': True,
            'userMessage': result.get('userMessage', {}),
            'aiResponse': result.get('modelMessage', {}),
            'thoughts': result.get('thoughts'),
            'metadata': {
                'tokens': result.get('usageMetadata', {}),
                'model': result.get('model'),
                'provider': result.get('provider')
            },
            'updatedGuestLimitations': session.get('guest_limitations') if session['user']['role'] == 'guest' else None
        })
    else:
        return jsonify({'success': False, 'error': result.get('error', 'Failed to send message')})

@app.route('/api/send-message-stream', methods=['POST'])
def send_message_stream():
    """Send message to AI with real streaming response"""
    if 'user' not in session:
        return jsonify({'success': False, 'error': 'Not authenticated'})
    
    data = request.get_json()
    token = session.get('token')
    
    def generate_stream():
        try:
            message_data = {
                'userId': session['user']['id'],
                'conversationId': data['conversationId'],
                'contents': data['message'],
                'model': data.get('model', 'gemini-2.5-flash'),
                'stream': True,  # Enable streaming
                'config': {
                    'temperature': float(data.get('temperature', 0.7)),
                    'maxOutputTokens': int(data.get('maxTokens', 2048)),
                    'thinkingConfig': {
                        'includeThoughts': data.get('includeThoughts', True),
                        'thinkingBudget': int(data.get('thinkingBudget', -1))
                    }
                }
            }
            
            # Add files if provided
            if data.get('files'):
                message_data['files'] = data['files']
            
            # Make request to backend with streaming
            import requests
            backend_url = f"http://localhost:3000/api/ai/generate"
            
            response = requests.post(
                backend_url,
                json=message_data,
                headers={'Authorization': f'Bearer {token}'},
                stream=True
            )
            
            if response.status_code == 200:
                for line in response.iter_lines():
                    if line:
                        yield f"data: {line.decode('utf-8')}\n\n"
            else:
                yield f"data: {{'error': 'Failed to generate response'}}\n\n"
                
        except Exception as e:
            yield f"data: {{'error': 'Stream error: {str(e)}'}}\n\n"
        
        yield "data: [DONE]\n\n"
    
    return Response(
        generate_stream(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        }
    )

@app.route('/api/get-messages/<conversation_id>')
def get_messages(conversation_id):
    """Get messages for a conversation"""
    if 'user' not in session:
        return jsonify({'success': False, 'error': 'Not authenticated'})
    
    token = session.get('token')
    user_id = session['user']['id']
    
    result = make_backend_request(f'conversations/{conversation_id}/messages', 'GET', token=token)
    
    if result.get('success'):
        return jsonify({'success': True, 'messages': result.get('data', [])})
    else:
        return jsonify({'success': False, 'error': result.get('error', 'Failed to get messages')})

@app.route('/api/delete-file/<file_id>', methods=['DELETE'])
def delete_file(file_id):
    """Delete an uploaded file"""
    if 'user' not in session:
        return jsonify({'success': False, 'error': 'Not authenticated'})
    
    token = session.get('token')
    user_id = session['user']['id']
    
    result = make_backend_request(f'files/{file_id}?userId={user_id}', 'DELETE', token=token)
    
    return jsonify(result)

@app.route('/api/debug/session')
def debug_session():
    """Debug endpoint to check session data"""
    if 'user' not in session:
        return jsonify({'error': 'Not authenticated'})
    
    return jsonify({
        'user': session.get('user'),
        'token': session.get('token', 'No token'),
        'guest_limitations': session.get('guest_limitations')
    })

@app.route('/api/debug/backend-test')
def test_backend():
    """Test backend connection"""
    if 'user' not in session:
        return jsonify({'error': 'Not authenticated'})
    
    token = session.get('token')
    user_id = session['user']['id']
    
    # Test multiple endpoints
    tests = {
        'health': make_backend_request('health', 'GET'),
        'conversations_get': make_backend_request(f'conversations?userId={user_id}&limit=5', 'GET', token=token),
        'user_profile': make_backend_request('users/profile', 'GET', token=token)
    }
    
    return jsonify(tests)

if __name__ == '__main__':
    app.run(debug=True, port=3000)