/**
 * Cypress plugins — provides tasks for database operations.
 * Runs in Node.js context (not browser).
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-e2e';

module.exports = (on, config) => {
  on('task', {
    /**
     * Generate a customer JWT token for E2E testing.
     * Bypasses OTP flow by creating token directly.
     */
    getCustomerToken(customerId) {
      const token = jwt.sign({ sub: customerId, actorType: 'CUSTOMER' }, JWT_SECRET, {
        expiresIn: '7d',
      });
      return token;
    },

    /**
     * Generate a staff JWT token for E2E testing.
     */
    getStaffToken(args) {
      const token = jwt.sign({ sub: args.userId, actorType: 'USER', role: args.role }, JWT_SECRET, {
        expiresIn: '1h',
      });
      return token;
    },

    /**
     * Log message (for debugging).
     */
    log(message) {
      console.log(`[CYPRESS] ${message}`);
      return null;
    },
  });

  return config;
};
