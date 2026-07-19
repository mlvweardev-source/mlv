/**
 * Cypress plugins — provides tasks for database operations.
 * Runs in Node.js context (not browser).
 */
import { signJwt } from '@mlv/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-e2e';

module.exports = (on: any, config: any) => {
  on('task', {
    /**
     * Generate a customer JWT token for E2E testing.
     * Bypasses OTP flow by creating token directly.
     */
    getCustomerToken(customerId: string) {
      const token = signJwt({ sub: customerId, actorType: 'CUSTOMER' }, JWT_SECRET, '7d');
      return token;
    },

    /**
     * Generate a staff JWT token for E2E testing.
     */
    getStaffToken(args: { userId: string; role: string }) {
      const token = signJwt(
        { sub: args.userId, actorType: 'USER', role: args.role },
        JWT_SECRET,
        '1h',
      );
      return token;
    },

    /**
     * Log message (for debugging).
     */
    log(message: string) {
      console.log(`[CYPRESS] ${message}`);
      return null;
    },
  });

  return config;
};
