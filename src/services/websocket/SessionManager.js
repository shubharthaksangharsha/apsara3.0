/**
 * Session Manager
 * Manages Live API sessions, handles session resumption, and tracks session state
 */
export class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionResumptionTokens = new Map();
  }

  /**
   * Add a new session
   * @param {string} sessionId - Session ID
   * @param {Object} sessionData - Session data
   */
  addSession(sessionId, sessionData) {
    this.sessions.set(sessionId, {
      ...sessionData,
      createdAt: new Date(),
      lastActivity: new Date()
    });
  }

  /**
   * Get a session
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Session data or null if not found
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Update session activity
   * @param {string} sessionId - Session ID
   */
  updateSessionActivity(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  /**
   * Remove a session
   * @param {string} sessionId - Session ID
   */
  removeSession(sessionId) {
    this.sessions.delete(sessionId);
    
    // Clean up any associated resumption tokens
    for (const [token, data] of this.sessionResumptionTokens) {
      if (data.sessionId === sessionId) {
        this.sessionResumptionTokens.delete(token);
      }
    }
  }

  /**
   * Get all sessions for a client
   * @param {string} clientId - Client ID
   * @returns {Array} Array of sessions
   */
  getSessionsForClient(clientId) {
    const clientSessions = [];
    for (const [sessionId, sessionData] of this.sessions) {
      if (sessionData.clientId === clientId) {
        clientSessions.push({ sessionId, ...sessionData });
      }
    }
    return clientSessions;
  }

  /**
   * Create a session resumption token
   * @param {string} sessionId - Session ID
   * @param {Object} sessionState - Session state to resume
   * @returns {string} Resumption token
   */
  createResumptionToken(sessionId, sessionState) {
    const token = `resume_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.sessionResumptionTokens.set(token, {
      sessionId,
      sessionState,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    });

    return token;
  }

  /**
   * Resume a session using a resumption token
   * @param {string} token - Resumption token
   * @returns {Object|null} Session state or null if token invalid/expired
   */
  resumeSession(token) {
    const resumptionData = this.sessionResumptionTokens.get(token);
    
    if (!resumptionData) {
      return null;
    }

    // Check if token has expired
    if (new Date() > resumptionData.expiresAt) {
      this.sessionResumptionTokens.delete(token);
      return null;
    }

    return resumptionData.sessionState;
  }

  /**
   * Clean up expired sessions and resumption tokens
   */
  cleanup() {
    const now = new Date();
    const sessionTimeout = 30 * 60 * 1000; // 30 minutes

    // Clean up inactive sessions
    for (const [sessionId, sessionData] of this.sessions) {
      if (now - sessionData.lastActivity > sessionTimeout) {
        console.log(`Cleaning up inactive session: ${sessionId}`);
        this.removeSession(sessionId);
      }
    }

    // Clean up expired resumption tokens
    for (const [token, data] of this.sessionResumptionTokens) {
      if (now > data.expiresAt) {
        this.sessionResumptionTokens.delete(token);
      }
    }
  }

  /**
   * Get session statistics
   * @returns {Object} Session statistics
   */
  getSessionStats() {
    const stats = {
      totalSessions: this.sessions.size,
      byProvider: {},
      byModel: {},
      resumptionTokens: this.sessionResumptionTokens.size
    };

    for (const sessionData of this.sessions.values()) {
      // Count by provider
      stats.byProvider[sessionData.provider] = (stats.byProvider[sessionData.provider] || 0) + 1;
      
      // Count by model
      stats.byModel[sessionData.model] = (stats.byModel[sessionData.model] || 0) + 1;
    }

    return stats;
  }

  /**
   * Get detailed session information
   * @returns {Array} Array of session details
   */
  getSessionDetails() {
    const details = [];
    
    for (const [sessionId, sessionData] of this.sessions) {
      details.push({
        sessionId,
        clientId: sessionData.clientId,
        provider: sessionData.provider,
        model: sessionData.model,
        createdAt: sessionData.createdAt,
        lastActivity: sessionData.lastActivity,
        duration: new Date() - sessionData.createdAt
      });
    }

    return details.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  /**
   * Force close a session
   * @param {string} sessionId - Session ID
   * @returns {boolean} True if session was found and closed
   */
  forceCloseSession(sessionId) {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      return false;
    }

    try {
      if (sessionData.session && typeof sessionData.session.close === 'function') {
        sessionData.session.close();
      }
      this.removeSession(sessionId);
      return true;
    } catch (error) {
      console.error(`Error force closing session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Get session count by client
   * @param {string} clientId - Client ID
   * @returns {number} Number of sessions for the client
   */
  getSessionCountForClient(clientId) {
    let count = 0;
    for (const sessionData of this.sessions.values()) {
      if (sessionData.clientId === clientId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Start periodic cleanup
   */
  startPeriodicCleanup() {
    // Run cleanup every 10 minutes
    setInterval(() => {
      this.cleanup();
    }, 10 * 60 * 1000);
    
    console.log('✅ Session Manager periodic cleanup started');
  }
} 