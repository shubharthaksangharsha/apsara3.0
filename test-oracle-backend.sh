#!/bin/bash

# ==============================================================================
# Apsara Backend - Oracle Cloud Testing Script
# URL: https://apsara-backend.devshubh.me
# ==============================================================================

BASE_URL="https://apsara-backend.devshubh.me"
echo "🚀 Testing Apsara Backend on Oracle Cloud"
echo "🌐 Base URL: $BASE_URL"
echo "============================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print section headers
print_section() {
    echo -e "\n${BLUE}=== $1 ===${NC}"
}

# Function to print test results
print_test() {
    echo -e "${YELLOW}➤ $1${NC}"
}

# ==============================================================================
# 1. HEALTH CHECK
# ==============================================================================
print_section "1. HEALTH CHECK"

print_test "Health Check"
curl -X GET "$BASE_URL/health" \
  -H "Content-Type: application/json" \
  -w "\nStatus: %{http_code}\n" | jq .

print_test "API Documentation"
curl -X GET "$BASE_URL/api" \
  -w "\nStatus: %{http_code}\n"

# ==============================================================================
# 2. USER MANAGEMENT
# ==============================================================================
print_section "2. USER MANAGEMENT"

print_test "Register New User"
curl -X POST "$BASE_URL/api/users/register" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Test User Oracle",
    "email": "test.oracle@example.com",
    "password": "TestPassword123!",
    "acceptTerms": true
  }' \
  -w "\nStatus: %{http_code}\n" | jq .

print_test "Verify Email (Mock OTP: 123456)"
curl -X POST "$BASE_URL/api/users/verify-email" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test.oracle@example.com",
    "otp": "123456"
  }' \
  -w "\nStatus: %{http_code}\n" | jq .

print_test "Login User"
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/users/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test.oracle@example.com",
    "password": "TestPassword123!"
  }')
echo $LOGIN_RESPONSE | jq .

# Extract token for authenticated requests
TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.data.token // empty')
USER_ID=$(echo $LOGIN_RESPONSE | jq -r '.data.user.id // empty')

print_test "Google OAuth Login (Mock)"
curl -X POST "$BASE_URL/api/users/google-auth" \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "mock_google_token_oracle_test",
    "email": "google.oracle@example.com",
    "name": "Google Oracle User",
    "picture": null
  }' \
  -w "\nStatus: %{http_code}\n" | jq .

print_test "Guest Login"
GUEST_RESPONSE=$(curl -s -X POST "$BASE_URL/api/users/guest-login" \
  -H "Content-Type: application/json" \
  -d '{}')
echo $GUEST_RESPONSE | jq .

# ==============================================================================
# 3. CONVERSATION MANAGEMENT
# ==============================================================================
print_section "3. CONVERSATION MANAGEMENT"

if [ ! -z "$TOKEN" ] && [ ! -z "$USER_ID" ]; then
    print_test "Create Conversation"
    CONV_RESPONSE=$(curl -s -X POST "$BASE_URL/api/conversations" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{
        "title": "Oracle Test Conversation",
        "type": "rest",
        "config": {
          "rest": {
            "systemInstruction": "You are a helpful AI assistant for testing the Oracle deployment.",
            "temperature": 0.7,
            "maxOutputTokens": 2048
          }
        }
      }')
    echo $CONV_RESPONSE | jq .
    
    CONV_ID=$(echo $CONV_RESPONSE | jq -r '.data.conversationId // empty')
    
    print_test "List Conversations"
    curl -X GET "$BASE_URL/api/conversations?limit=10" \
      -H "Authorization: Bearer $TOKEN" \
      -w "\nStatus: %{http_code}\n" | jq .
    
    if [ ! -z "$CONV_ID" ]; then
        print_test "Get Conversation Details"
        curl -X GET "$BASE_URL/api/conversations/$CONV_ID" \
          -H "Authorization: Bearer $TOKEN" \
          -w "\nStatus: %{http_code}\n" | jq .
    fi
else
    echo -e "${RED}⚠️ Skipping conversation tests - no authentication token${NC}"
fi

# ==============================================================================
# 4. AI GENERATION
# ==============================================================================
print_section "4. AI GENERATION"

if [ ! -z "$TOKEN" ] && [ ! -z "$CONV_ID" ]; then
    print_test "AI Generate Message"
    AI_RESPONSE=$(curl -s -X POST "$BASE_URL/api/ai/generate" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{
        \"userId\": \"$USER_ID\",
        \"conversationId\": \"$CONV_ID\",
        \"contents\": \"Hello! This is a test message from Oracle Cloud deployment. Please respond with a greeting and confirm you can process this message.\",
        \"model\": \"gemini-2.5-flash\",
        \"provider\": \"google\",
        \"config\": {
          \"temperature\": 0.7,
          \"maxOutputTokens\": 1024,
          \"thinkingConfig\": {
            \"thinkingBudget\": -1,
            \"includeThoughts\": true
          }
        }
      }")
    echo $AI_RESPONSE | jq .
    
    MESSAGE_ID=$(echo $AI_RESPONSE | jq -r '.modelMessage.messageId // empty')
    
    print_test "AI Generate with Thinking Off"
    curl -X POST "$BASE_URL/api/ai/generate" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{
        \"userId\": \"$USER_ID\",
        \"conversationId\": \"$CONV_ID\",
        \"contents\": \"What's 2+2? Please answer briefly.\",
        \"model\": \"gemini-2.5-flash\",
        \"config\": {
          \"temperature\": 0.1,
          \"maxOutputTokens\": 100,
          \"thinkingConfig\": {
            \"thinkingBudget\": 0,
            \"includeThoughts\": false
          }
        }
      }" \
      -w "\nStatus: %{http_code}\n" | jq .
    
    if [ ! -z "$MESSAGE_ID" ]; then
        print_test "Regenerate AI Response"
        curl -X POST "$BASE_URL/api/ai/regenerate" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN" \
          -d "{
            \"userId\": \"$USER_ID\",
            \"conversationId\": \"$CONV_ID\",
            \"messageId\": \"$MESSAGE_ID\",
            \"model\": \"gemini-2.5-pro\",
            \"config\": {
              \"temperature\": 0.8,
              \"maxOutputTokens\": 1024,
              \"thinkingConfig\": {
                \"thinkingBudget\": -1,
                \"includeThoughts\": true
              }
            }
          }" \
          -w "\nStatus: %{http_code}\n" | jq .
    fi
else
    echo -e "${RED}⚠️ Skipping AI tests - no authentication or conversation${NC}"
fi

# ==============================================================================
# 5. FILE MANAGEMENT
# ==============================================================================
print_section "5. FILE MANAGEMENT"

print_test "Get Supported File Types"
curl -X GET "$BASE_URL/api/files/supported-types" \
  -w "\nStatus: %{http_code}\n" | jq .

if [ ! -z "$TOKEN" ]; then
    print_test "Create Test File for Upload"
    echo "This is a test file for Oracle deployment testing." > test-file.txt
    echo "Date: $(date)" >> test-file.txt
    echo "Server: Oracle Cloud" >> test-file.txt
    
    print_test "Upload File (Local Storage)"
    UPLOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/api/files/upload" \
      -H "Authorization: Bearer $TOKEN" \
      -F "files=@test-file.txt" \
      -F "storageMethod=local" \
      -F "userId=$USER_ID" \
      -F "displayName=Oracle Test File")
    echo $UPLOAD_RESPONSE | jq .
    
    FILE_ID=$(echo $UPLOAD_RESPONSE | jq -r '.files[0].fileId // empty')
    
    print_test "Upload File (Google File API)"
    curl -X POST "$BASE_URL/api/files/upload" \
      -H "Authorization: Bearer $TOKEN" \
      -F "files=@test-file.txt" \
      -F "storageMethod=google-file-api" \
      -F "userId=$USER_ID" \
      -F "displayName=Oracle Test File Google" \
      -w "\nStatus: %{http_code}\n" | jq .
    
    print_test "List User Files"
    curl -X GET "$BASE_URL/api/files?limit=10" \
      -H "Authorization: Bearer $TOKEN" \
      -w "\nStatus: %{http_code}\n" | jq .
    
    if [ ! -z "$FILE_ID" ]; then
        print_test "Get File Metadata"
        curl -X GET "$BASE_URL/api/files/$FILE_ID" \
          -H "Authorization: Bearer $TOKEN" \
          -w "\nStatus: %{http_code}\n" | jq .
        
        print_test "AI Generate with File"
        curl -X POST "$BASE_URL/api/ai/generate" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN" \
          -d "{
            \"userId\": \"$USER_ID\",
            \"conversationId\": \"$CONV_ID\",
            \"contents\": \"Please analyze this file and tell me what it contains.\",
            \"files\": [\"$FILE_ID\"],
            \"model\": \"gemini-2.5-flash\",
            \"config\": {
              \"temperature\": 0.7,
              \"maxOutputTokens\": 1024
            }
          }" \
          -w "\nStatus: %{http_code}\n" | jq .
        
        print_test "Download File"
        curl -X GET "$BASE_URL/api/files/$FILE_ID/download" \
          -H "Authorization: Bearer $TOKEN" \
          -w "\nStatus: %{http_code}\n"
        
        print_test "Delete File"
        curl -X DELETE "$BASE_URL/api/files/$FILE_ID" \
          -H "Authorization: Bearer $TOKEN" \
          -w "\nStatus: %{http_code}\n" | jq .
    fi
    
    # Clean up test file
    rm -f test-file.txt
else
    echo -e "${RED}⚠️ Skipping file tests - no authentication token${NC}"
fi

# ==============================================================================
# 6. PLUGIN SYSTEM
# ==============================================================================
print_section "6. PLUGIN SYSTEM"

if [ ! -z "$TOKEN" ] && [ ! -z "$CONV_ID" ]; then
    print_test "Get Available Plugins"
    curl -X GET "$BASE_URL/api/plugins/google" \
      -H "Authorization: Bearer $TOKEN" \
      -w "\nStatus: %{http_code}\n" | jq .
    
    print_test "Calculator Plugin"
    curl -X POST "$BASE_URL/api/plugins/google/calculator/send" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{
        \"userId\": \"$USER_ID\",
        \"conversationId\": \"$CONV_ID\",
        \"parameters\": {
          \"operation\": \"add\",
          \"number1\": 15,
          \"number2\": 25
        },
        \"runAsync\": false,
        \"sendToModel\": true,
        \"modelConfig\": {
          \"model\": \"gemini-2.5-flash\",
          \"provider\": \"google\",
          \"temperature\": 0.7
        }
      }" \
      -w "\nStatus: %{http_code}\n" | jq .
    
    print_test "Echo Plugin"
    curl -X POST "$BASE_URL/api/plugins/google/echo/send" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{
        \"userId\": \"$USER_ID\",
        \"conversationId\": \"$CONV_ID\",
        \"parameters\": {
          \"message\": \"Hello from Oracle Cloud deployment!\"
        },
        \"runAsync\": false,
        \"sendToModel\": true
      }" \
      -w "\nStatus: %{http_code}\n" | jq .
else
    echo -e "${RED}⚠️ Skipping plugin tests - no authentication or conversation${NC}"
fi

# ==============================================================================
# 7. MESSAGE MANAGEMENT
# ==============================================================================
print_section "7. MESSAGE MANAGEMENT"

if [ ! -z "$TOKEN" ] && [ ! -z "$CONV_ID" ]; then
    print_test "Get Conversation Messages"
    MESSAGES_RESPONSE=$(curl -s -X GET "$BASE_URL/api/conversations/$CONV_ID/messages?limit=20" \
      -H "Authorization: Bearer $TOKEN")
    echo $MESSAGES_RESPONSE | jq .
    
    # Get a user message for editing
    USER_MESSAGE_ID=$(echo $MESSAGES_RESPONSE | jq -r '.data.messages[] | select(.role == "user") | .messageId' | head -1)
    
    if [ ! -z "$USER_MESSAGE_ID" ]; then
        print_test "Edit Message"
        curl -X POST "$BASE_URL/api/ai/edit-message" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN" \
          -d "{
            \"userId\": \"$USER_ID\",
            \"conversationId\": \"$CONV_ID\",
            \"messageId\": \"$USER_MESSAGE_ID\",
            \"newContent\": \"This is an edited message from Oracle Cloud testing.\",
            \"model\": \"gemini-2.5-flash\",
            \"config\": {
              \"temperature\": 0.7,
              \"maxOutputTokens\": 1024
            }
          }" \
          -w "\nStatus: %{http_code}\n" | jq .
    fi
else
    echo -e "${RED}⚠️ Skipping message tests - no authentication or conversation${NC}"
fi

# ==============================================================================
# 8. STATISTICS & MONITORING
# ==============================================================================
print_section "8. STATISTICS & MONITORING"

if [ ! -z "$TOKEN" ]; then
    print_test "Get User Usage Statistics"
    curl -X GET "$BASE_URL/api/users/usage" \
      -H "Authorization: Bearer $TOKEN" \
      -w "\nStatus: %{http_code}\n" | jq .
    
    print_test "Get User Profile"
    curl -X GET "$BASE_URL/api/users/profile" \
      -H "Authorization: Bearer $TOKEN" \
      -w "\nStatus: %{http_code}\n" | jq .
else
    echo -e "${RED}⚠️ Skipping statistics tests - no authentication token${NC}"
fi

# ==============================================================================
# 9. WEBSOCKET CONNECTION TEST
# ==============================================================================
print_section "9. WEBSOCKET CONNECTION TEST"

print_test "WebSocket Connection (Manual Test Required)"
echo "To test WebSocket connection manually:"
echo "wscat -c wss://apsara-backend.devshubh.me/live"
echo "Or use browser console:"
echo "const ws = new WebSocket('wss://apsara-backend.devshubh.me/live');"

# ==============================================================================
# 10. ERROR HANDLING TESTS
# ==============================================================================
print_section "10. ERROR HANDLING TESTS"

print_test "Invalid Endpoint"
curl -X GET "$BASE_URL/api/invalid-endpoint" \
  -w "\nStatus: %{http_code}\n" | jq .

print_test "Unauthorized Request"
curl -X GET "$BASE_URL/api/conversations" \
  -w "\nStatus: %{http_code}\n" | jq .

print_test "Invalid JSON"
curl -X POST "$BASE_URL/api/users/login" \
  -H "Content-Type: application/json" \
  -d '{"invalid": json}' \
  -w "\nStatus: %{http_code}\n" | jq .

# ==============================================================================
# SUMMARY
# ==============================================================================
print_section "TESTING COMPLETE"
echo -e "${GREEN}✅ Oracle Cloud backend testing completed!${NC}"
echo -e "${BLUE}🌐 Your backend is available at: $BASE_URL${NC}"
echo -e "${YELLOW}📋 Review the responses above for any errors${NC}"
echo ""
echo "🔧 Manual tests you can run:"
echo "1. Visit $BASE_URL/api in your browser"
echo "2. Test WebSocket: wscat -c wss://apsara-backend.devshubh.me/live"
echo "3. Upload large files to test limits"
echo "4. Test with real Google OAuth tokens"
echo ""
echo "🚀 Ready to build your frontend application!" 