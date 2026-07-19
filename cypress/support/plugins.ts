/**
 * Cypress plugins — provides tasks for database operations.
 * Runs in Node.js context (not browser).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-e2e';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
module.exports = (on: any, config: any) => {
  on('task', {
    getCustomerToken(customerId: string) {
      return jwt.sign({ sub: customerId, actorType: 'CUSTOMER' }, JWT_SECRET, { expiresIn: '7d' });
    },
    getStaffToken(args: { userId: string; role: string }) {
      return jwt.sign({ sub: args.userId, actorType: 'USER', role: args.role }, JWT_SECRET, {
        expiresIn: '1h',
      });
    },
    log(message: string) {
      console.log(`[CYPRESS] ${message}`);
      return null;
    },
  });

  return config;
};
