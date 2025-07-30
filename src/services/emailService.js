import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialize();
  }

  async initialize() {
    try {
      // Create nodemailer transporter using Gmail SMTP
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: false, // true for 465, false for other ports
        auth: {
          user: process.env.EMAIL_USERNAME,
          pass: process.env.EMAIL_PASSWORD
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      // Verify the transporter
      await this.transporter.verify();
      console.log('✅ Email service initialized successfully');
    } catch (error) {
      console.error('❌ Email service initialization failed:', error);
    }
  }

  async sendVerificationOTP(userEmail, userName, otp) {
    try {
      const mailOptions = {
        from: {
          name: 'Apsara AI',
          address: process.env.EMAIL_USERNAME
        },
        to: userEmail,
        subject: 'Apsara AI - Your Verification Code',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #6750A4, #3F51B5); color: white; padding: 30px 20px; text-align: center; }
              .content { padding: 30px 20px; text-align: center; }
              .otp-code { background: #f8f9fa; padding: 20px; border-radius: 10px; font-size: 32px; font-weight: bold; color: #6750A4; letter-spacing: 8px; margin: 20px 0; border: 2px dashed #6750A4; }
              .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
              .logo { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
              .warning { color: #e74c3c; font-size: 14px; margin-top: 15px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <div class="logo">🚀 Apsara AI</div>
                <h1>Welcome to the Future of AI!</h1>
              </div>
              <div class="content">
                <h2>Hello ${userName}!</h2>
                <p style="font-size: 16px; margin-bottom: 30px;">Thank you for joining Apsara AI! We're excited to have you on board.</p>
                <p style="font-size: 16px;">Your verification code is:</p>
                
                <div class="otp-code">${otp}</div>
                
                <p style="font-size: 16px; margin-top: 30px;">Enter this code in the app to verify your email address and start your AI-powered journey!</p>
                <p class="warning">⏰ This code will expire in 10 minutes</p>
                
                <div style="margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 10px;">
                  <h3 style="color: #6750A4; margin-bottom: 15px;">What you can do with Apsara AI:</h3>
                  <ul style="text-align: left; display: inline-block;">
                    <li>💬 <strong>Smart Chat:</strong> Engage with advanced AI models</li>
                    <li>📄 <strong>File Analysis:</strong> Upload and analyze documents, images, videos</li>
                    <li>🔧 <strong>Function Calling:</strong> Use AI tools and integrations</li>
                    <li>⚡ <strong>Real-time Streaming:</strong> Get instant AI responses</li>
                    <li>🧠 <strong>Context Caching:</strong> Efficient conversations</li>
                  </ul>
                </div>
              </div>
              <div class="footer">
                <p>If you didn't request this verification code, please ignore this email.</p>
                <p style="color: #999;">© 2024 Apsara AI. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Verification OTP sent to', userEmail);
      
      return {
        success: true,
        messageId: result.messageId,
        response: result.response
      };
    } catch (error) {
      console.error('❌ Failed to send verification OTP:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async sendPasswordResetEmail(userEmail, userName, resetToken) {
    try {
      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5000'}/reset-password?token=${resetToken}`;
      
      const mailOptions = {
        from: {
          name: 'Apsara AI',
          address: process.env.EMAIL_USERNAME
        },
        to: userEmail,
        subject: 'Reset Your Apsara AI Password',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #6750A4, #3F51B5); color: white; padding: 30px 20px; text-align: center; }
              .content { padding: 30px 20px; }
              .button { display: inline-block; background: linear-gradient(135deg, #6750A4, #3F51B5); color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; font-weight: bold; margin: 20px 0; }
              .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
              .logo { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
              .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <div class="logo">🔐 Apsara AI</div>
                <h1>Password Reset Request</h1>
              </div>
              <div class="content">
                <h2>Hello ${userName}!</h2>
                <p>We received a request to reset your password for your Apsara AI account.</p>
                <p>Click the button below to reset your password:</p>
                <div style="text-align: center;">
                  <a href="${resetUrl}" class="button">Reset Password</a>
                </div>
                <p>Or copy and paste this link in your browser:</p>
                <p style="word-break: break-all; color: #6750A4;">${resetUrl}</p>
                <div class="warning">
                  <strong>⚠️ Important:</strong>
                  <ul>
                    <li>This reset link will expire in 1 hour</li>
                    <li>If you didn't request this reset, please ignore this email</li>
                    <li>Your password will remain unchanged unless you click the link above</li>
                  </ul>
                </div>
              </div>
              <div class="footer">
                <p>© 2024 Apsara AI. All rights reserved.</p>
                <p>For security reasons, this link will expire soon.</p>
              </div>
            </div>
          </body>
          </html>
        `
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Password reset email sent to ${userEmail}`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('❌ Failed to send password reset email:', error);
      return { success: false, error: error.message };
    }
  }

  async sendPasswordResetOTP(userEmail, userName, otp) {
    try {
      const mailOptions = {
        from: {
          name: 'Apsara AI',
          address: process.env.EMAIL_USERNAME
        },
        to: userEmail,
        subject: 'Apsara AI - Password Reset Code',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #6750A4, #3F51B5); color: white; padding: 30px 20px; text-align: center; }
              .content { padding: 30px 20px; text-align: center; }
              .otp-code { background: #f8f9fa; padding: 20px; border-radius: 10px; font-size: 32px; font-weight: bold; color: #6750A4; letter-spacing: 8px; margin: 20px 0; border: 2px dashed #6750A4; }
              .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
              .logo { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
              .warning { color: #e74c3c; font-size: 14px; margin-top: 15px; }
              .security-note { background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <div class="logo">🔐 Apsara AI</div>
                <h1>Password Reset Request</h1>
              </div>
              <div class="content">
                <h2>Hello ${userName}!</h2>
                <p style="font-size: 16px; margin-bottom: 30px;">You requested to reset your password. Use the verification code below:</p>
                
                <div class="otp-code">${otp}</div>
                
                <p style="font-size: 16px; margin-top: 30px;">Enter this code in the app to verify your identity and set a new password.</p>
                <p class="warning">⏰ This code will expire in 15 minutes</p>
                
                <div class="security-note">
                  <h4 style="margin-top: 0; color: #856404;">🛡️ Security Notice</h4>
                  <ul style="text-align: left; display: inline-block; color: #856404;">
                    <li>Never share this code with anyone</li>
                    <li>Apsara AI will never ask for this code</li>
                    <li>If you didn't request this, ignore this email</li>
                  </ul>
                </div>
              </div>
              <div class="footer">
                <p>If you didn't request a password reset, please ignore this email.</p>
                <p style="color: #999;">© 2024 Apsara AI. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Password reset OTP sent to', userEmail);
      
      return {
        success: true,
        messageId: result.messageId,
        response: result.response
      };
    } catch (error) {
      console.error('❌ Failed to send password reset OTP:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async sendWelcomeEmail(userEmail, userName) {
    try {
      const mailOptions = {
        from: {
          name: 'Apsara AI',
          address: process.env.EMAIL_USERNAME
        },
        to: userEmail,
        subject: 'Welcome to Apsara AI - Your Account is Ready!',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
              .header { background: linear-gradient(135deg, #6750A4, #3F51B5); color: white; padding: 30px 20px; text-align: center; }
              .content { padding: 30px 20px; }
              .feature-box { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #6750A4; }
              .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
              .logo { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <div class="logo">🎉 Apsara AI</div>
                <h1>Welcome ${userName}!</h1>
                <p>Your AI journey starts now</p>
              </div>
              <div class="content">
                <h2>🚀 You're all set!</h2>
                <p>Congratulations! Your Apsara AI account has been successfully verified and is ready to use.</p>
                
                <div class="feature-box">
                  <h3>💬 Smart Chat</h3>
                  <p>Start conversations with advanced AI models like Gemini 2.5 Flash and Pro</p>
                </div>
                
                <div class="feature-box">
                  <h3>📄 File Analysis</h3>
                  <p>Upload documents, images, audio, and videos for AI-powered analysis</p>
                </div>
                
                <div class="feature-box">
                  <h3>🔧 Function Calling</h3>
                  <p>Use AI tools and integrations to enhance your workflows</p>
                </div>
                
                <div class="feature-box">
                  <h3>⚡ Real-time Features</h3>
                  <p>Experience streaming responses and live AI interactions</p>
                </div>
                
                <p><strong>Ready to explore?</strong> Open your Apsara AI app and start your first conversation!</p>
              </div>
              <div class="footer">
                <p>© 2024 Apsara AI. All rights reserved.</p>
                <p>Need help? Contact us at support@apsara-ai.com</p>
              </div>
            </div>
          </body>
          </html>
        `
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Welcome email sent to ${userEmail}`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('❌ Failed to send welcome email:', error);
      return { success: false, error: error.message };
    }
  }

  // Test email connection
  async testConnection() {
    try {
      await this.transporter.verify();
      return { success: true, message: 'Email service is working correctly' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

export default new EmailService(); 