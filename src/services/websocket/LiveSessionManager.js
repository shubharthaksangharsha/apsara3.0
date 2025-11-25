/**
 * Live Session Manager
 * Manages Live API sessions and tracks session state
 */
export class LiveSessionManager {
  constructor() {
    this.sessions = new Map();
    this.cleanupInterval = null;
  }

  /**
   * Add a new session
   */
  addSession(sessionId, data) {
    this.sessions.set(sessionId, {
      ...data,
      createdAt: new Date(),
      lastActivity: new Date()
    });
    console.log(`📌 Session added: ${sessionId}`);
  }

  /**
   * Get a session
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Update session activity
   */
  updateActivity(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  /**
   * Remove a session
   */
  removeSession(sessionId) {
    this.sessions.delete(sessionId);
    console.log(`🗑️ Session removed: ${sessionId}`);
  }

  /**
   * Get sessions for a client
   */
  getSessionsForClient(clientId) {
    const sessions = [];
    for (const [sessionId, data] of this.sessions) {
      if (data.clientId === clientId) {
        sessions.push({ sessionId, ...data });
      }
    }
    return sessions;
  }

  /**
   * Get session statistics
   */
  getSessionStats() {
    const stats = {
      total: this.sessions.size,
      byModel: {}
    };

    for (const data of this.sessions.values()) {
      stats.byModel[data.model] = (stats.byModel[data.model] || 0) + 1;
    }

    return stats;
  }

  /**
   * Cleanup inactive sessions
   */
  cleanup() {
    const now = Date.now();
    const timeout = parseInt(process.env.SESSION_TIMEOUT) || 900000; // 15 minutes

    for (const [sessionId, data] of this.sessions) {
      if (now - data.lastActivity.getTime() > timeout) {
        console.log(`🧹 Cleaning up inactive session: ${sessionId}`);
        this.removeSession(sessionId);
      }
    }
  }

  /**
   * Start periodic cleanup
   */
  startPeriodicCleanup() {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Every 5 minutes

    console.log('✅ Session cleanup started');
  }

  /**
   * Stop periodic cleanup
   */
  stopPeriodicCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

