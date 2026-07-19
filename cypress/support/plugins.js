/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-console */

const jwt = require('jsonwebtoken');
const bcryptjs = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-e2e';
const prisma = new PrismaClient();

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
    async seedOtp({ phone, code }) {
      const codeHash = await bcryptjs.hash(code, 6);
      await prisma.otpCode.create({
        data: {
          phone,
          codeHash,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          isUsed: false,
          attempts: 0,
        },
      });
      return null;
    },
    log(message) {
      console.log(`[CYPRESS] ${message}`);
      return null;
    },
  });

  return config;
};
