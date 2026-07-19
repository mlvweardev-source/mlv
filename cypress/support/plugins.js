/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-console */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-e2e';

module.exports = (on, config) => {
  on('task', {
    getCustomerToken(customerId) {
      return jwt.sign({ sub: customerId, actorType: 'CUSTOMER' }, JWT_SECRET, { expiresIn: '7d' });
    },
    getStaffToken(args) {
      return jwt.sign({ sub: args.userId, actorType: 'USER', role: args.role }, JWT_SECRET, {
        expiresIn: '1h',
      });
    },
    log(message) {
      console.log(`[CYPRESS] ${message}`);
      return null;
    },
  });

  return config;
};
