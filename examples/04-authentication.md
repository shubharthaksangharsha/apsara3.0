# Authentication Methods

This guide covers all authentication methods available in Apsara, including traditional registration, Google OAuth, and guest access.

## Authentication Overview

Apsara supports multiple authentication methods:

1. **Traditional Registration** - Email/password with OTP verification
2. **Google OAuth** - Sign in with Google account
3. **Guest Login** - Temporary access with limited features
4. **Password Reset** - Secure password recovery with OTP

All authenticated requests require a JWT token in the Authorization header:
```
Authorization: Bearer your_jwt_token_here
```

## 1. Traditional Registration Flow

### Step 1: Register User

```bash
curl -X POST http://localhost:5000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Alice Johnson",
    "email": "alice@example.com",
    "password": "SecurePass123!",
    "acceptTerms": true
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "User registered successfully! Please check your email for verification.",
  "data": {
    "user": {
      "id": "user_abc123",
      "fullName": "Alice Johnson",
      "email": "alice@example.com",
      "role": "user",
      "subscriptionPlan": "free",
      "isEmailVerified": false,
      "authProvider": "local"
    },
    "otpSent": true,
    "expiresIn": "10 minutes"
  }
}
```

### Step 2: Verify Email with OTP

```bash
curl -X POST http://localhost:5000/api/users/verify-email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "otp": "458392"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Email verified successfully!",
  "data": {
    "user": {
      "id": "user_abc123",
      "fullName": "Alice Johnson",
      "email": "alice@example.com",
      "isEmailVerified": true,
      "role": "user"
    }
  }
}
```

### Step 3: Login

```bash
curl -X POST http://localhost:5000/api/users/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "SecurePass123!"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "user_abc123",
      "fullName": "Alice Johnson",
      "email": "alice@example.com",
      "role": "user",
      "subscriptionPlan": "free",
      "authProvider": "local",
      "isEmailVerified": true
    },
    "tokenExpiration": "7d"
  }
}
```

## 2. Google OAuth Flow

### Initialize Google Login

```bash
curl -X POST http://localhost:5000/api/users/google-auth \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "google_id_token_here",
    "email": "user@gmail.com",
    "name": "Google User"
  }'
```

**Response (New User):**
```json
{
  "success": true,
  "message": "Account created and logged in successfully",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "user_def456",
      "fullName": "Google User",
      "email": "user@gmail.com",
      "role": "user",
      "subscriptionPlan": "free",
      "authProvider": "google",
      "googleId": "google_unique_id",
      "isEmailVerified": true,
      "profilePicture": "https://lh3.googleusercontent.com/..."
    },
    "usageInfo": {
      "dailyUsage": {
        "gemini-2.5-flash": { "count": 0, "limit": 20 },
        "gemini-2.5-pro": { "count": 0, "limit": 5 }
      },
      "totalUsage": {
        "totalMessages": 0,
        "totalTokens": 0
      }
    }
  }
}
```

**Response (Existing User):**
```json
{
  "success": true,
  "message": "Logged in successfully",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "user_def456",
      "fullName": "Google User",
      "email": "user@gmail.com",
      "role": "user",
      "subscriptionPlan": "free",
      "authProvider": "google"
    }
  }
}
```

### Frontend Integration Example

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://accounts.google.com/gsi/client" async defer></script>
</head>
<body>
  <div id="g_id_onload"
       data-client_id="your_google_client_id"
       data-callback="handleCredentialResponse">
  </div>
  <div class="g_id_signin" data-type="standard"></div>

  <script>
    function handleCredentialResponse(response) {
      // Send the ID token to your backend
      fetch('/api/users/google-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idToken: response.credential
        })
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          localStorage.setItem('token', data.data.token);
          localStorage.setItem('user', JSON.stringify(data.data.user));
          window.location.href = '/dashboard';
        }
      });
    }
  </script>
</body>
</html>
```

## 3. Guest Login

### Create Guest Session

```bash
curl -X POST http://localhost:5000/api/users/guest-login \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**
```json
{
  "success": true,
  "message": "Guest session created successfully",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "guest_xyz789",
      "fullName": "Guest User xyz789",
      "email": "guest-xyz789@apsara.local",
      "role": "guest",
      "subscriptionPlan": "guest",
      "isGuest": true,
      "sessionId": "xyz789"
    },
    "limitations": {
      "totalMessagesLimit": 5,
      "totalMessagesUsed": 0,
      "remainingMessages": 5,
      "availableModels": ["gemini-2.5-flash"],
      "sessionDuration": "24 hours"
    }
  }
}
```

### Resume Guest Session

```bash
curl -X POST http://localhost:5000/api/users/guest-login \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "xyz789"
  }'
```

## 4. Password Reset Flow

### Step 1: Request Password Reset

```bash
curl -X POST http://localhost:5000/api/users/forgot-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Password reset OTP sent to your email address!",
  "data": {
    "email": "alice@example.com",
    "otpSent": true,
    "expiresIn": "15 minutes"
  }
}
```

### Step 2: Verify Reset OTP

```bash
curl -X POST http://localhost:5000/api/users/verify-reset-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "otp": "829374"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "OTP verified successfully! You can now set a new password.",
  "data": {
    "email": "alice@example.com",
    "otpVerified": true
  }
}
```

### Step 3: Set New Password

```bash
curl -X POST http://localhost:5000/api/users/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "otp": "829374",
    "newPassword": "NewSecurePass456!"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Password updated successfully! You can now login with your new password.",
  "data": {
    "email": "alice@example.com"
  }
}
```

## 5. Token Management

### Using JWT Tokens

Include the token in all authenticated requests:

```bash
curl -X GET http://localhost:5000/api/users/profile \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Token Payload Structure

```json
{
  "id": "user_abc123",
  "email": "alice@example.com",
  "role": "user",
  "isEmailVerified": true,
  "iat": 1642204800,
  "exp": 1642809600,
  "iss": "apsara-ai"
}
```

### Token Validation

```javascript
// Frontend token validation
function isTokenValid(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 > Date.now();
  } catch (error) {
    return false;
  }
}

// Auto-refresh logic
function checkAndRefreshToken() {
  const token = localStorage.getItem('token');
  if (!token || !isTokenValid(token)) {
    // Redirect to login
    window.location.href = '/login';
  }
}
```

## 6. User Profile Management

### Get User Profile

```bash
curl -X GET http://localhost:5000/api/users/profile \
  -H "Authorization: Bearer your_jwt_token"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_abc123",
      "fullName": "Alice Johnson",
      "email": "alice@example.com",
      "role": "user",
      "subscriptionPlan": "free",
      "authProvider": "local",
      "profilePicture": null,
      "preferences": {
        "theme": "auto",
        "language": "en",
        "notifications": {
          "email": true,
          "push": true
        }
      },
      "usage": {
        "totalRequests": 156,
        "lastLogin": "2024-01-15T10:30:00Z"
      },
      "createdAt": "2024-01-01T12:00:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  }
}
```

### Update User Profile

```bash
curl -X PUT http://localhost:5000/api/users/profile \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Alice Smith",
    "preferences": {
      "theme": "dark",
      "notifications": {
        "email": false
      }
    }
  }'
```

## 7. Error Handling

### Common Authentication Errors

**Invalid Credentials (401):**
```json
{
  "success": false,
  "error": "Authentication failed",
  "details": "Invalid email or password"
}
```

**Expired Token (401):**
```json
{
  "success": false,
  "error": "Token expired",
  "details": "Please login again"
}
```

**Email Not Verified (403):**
```json
{
  "success": false,
  "error": "Email not verified",
  "details": "Please verify your email before accessing this resource"
}
```

**Rate Limited (429):**
```json
{
  "success": false,
  "error": "Too many login attempts",
  "details": "Account temporarily locked. Try again in 15 minutes."
}
```

## 8. Security Best Practices

### Password Requirements

- Minimum 6 characters
- Mix of uppercase, lowercase, numbers, and symbols recommended
- Not commonly used passwords
- Regular password updates encouraged

### Token Security

```javascript
// Secure token storage
class TokenManager {
  static setToken(token) {
    // Use httpOnly cookies in production
    localStorage.setItem('apsara_token', token);
  }
  
  static getToken() {
    return localStorage.getItem('apsara_token');
  }
  
  static removeToken() {
    localStorage.removeItem('apsara_token');
  }
  
  static isAuthenticated() {
    const token = this.getToken();
    return token && this.isTokenValid(token);
  }
}
```

### Logout Implementation

```bash
# Clear token client-side (server doesn't maintain sessions)
curl -X POST http://localhost:5000/api/users/logout \
  -H "Authorization: Bearer your_jwt_token"
```

```javascript
// Client-side logout
function logout() {
  TokenManager.removeToken();
  localStorage.removeItem('user');
  window.location.href = '/login';
}
```

## 9. Multi-Provider Account Linking

### Link Google Account to Existing User

```bash
curl -X POST http://localhost:5000/api/users/link-google \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "google_id_token_here"
  }'
```

### Account Merge Scenarios

When a user tries to login with Google but an account with that email already exists:

```json
{
  "success": false,
  "error": "Account exists with different provider",
  "details": "An account with this email already exists. Please login with your password or use 'Forgot Password' to reset it.",
  "suggestions": [
    "Login with email/password",
    "Reset password if forgotten",
    "Contact support for account merging"
  ]
}
```

## 10. Development Testing

### Create Test Users

```bash
# Script to create multiple test users
for i in {1..5}; do
  curl -X POST http://localhost:5000/api/users/register \
    -H "Content-Type: application/json" \
    -d "{
      \"fullName\": \"Test User $i\",
      \"email\": \"test$i@example.com\",
      \"password\": \"testpass123\",
      \"acceptTerms\": true
    }"
done
```

### Bypass Email Verification (Development Only)

```bash
curl -X POST http://localhost:5000/api/dev/auto-verify \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test1@example.com"
  }'
```

## Next Steps

- Explore [Advanced Examples](05-advanced-examples.md)
- Learn [CLI Usage](06-cli-usage.md)
- Check [API Reference](07-api-reference.md) 