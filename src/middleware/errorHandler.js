import dotenv from 'dotenv';

dotenv.config();

export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error
  let error = {
    message: err.message || 'Internal Server Error',
    status: err.status || err.statusCode || 500,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  };

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { message, status: 400 };
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    error = { message: `${field} already exists`, status: 400 };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = { message: 'Invalid token', status: 401 };
  }

  if (err.name === 'TokenExpiredError') {
    error = { message: 'Token expired', status: 401 };
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    error = { message: 'File too large', status: 413 };
  }

  // AI Provider errors
  if (err.name === 'GoogleGenAIError') {
    error = { 
      message: 'AI service error: ' + err.message, 
      status: err.status || 502,
      provider: 'google'
    };
  }

  // Rate limiting errors
  if (err.name === 'TooManyRequestsError') {
    error = { 
      message: 'Too many requests, please try again later', 
      status: 429,
      retryAfter: err.retryAfter
    };
  }

  res.status(error.status).json({
    success: false,
    error: {
      message: error.message,
      ...(error.provider && { provider: error.provider }),
      ...(error.retryAfter && { retryAfter: error.retryAfter }),
      ...(process.env.NODE_ENV === 'development' && error.stack && { stack: error.stack })
    }
  });
};

export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.originalUrl} not found`,
      status: 404
    }
  });
};

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
}; 