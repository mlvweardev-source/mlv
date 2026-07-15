import { INestApplication, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getQueueToken } from '@nestjs/bullmq';
import { ALL_QUEUES } from '@mlv/types';
import type { Request, Response, NextFunction } from 'express';

/**
 * Bull Board — Monitoring queue BullMQ (§22)
 *
 * Mount di /admin/queues dengan HTTP Basic Auth terpisah.
 * KEAMANAN: payload job bisa berisi data sensitif (info pembayaran,
 * data pelanggan) — endpoint TIDAK boleh publik tanpa auth.
 * Kredensial via env BULL_BOARD_USER / BULL_BOARD_PASSWORD;
 * jika BULL_BOARD_PASSWORD tidak di-set, Bull Board DINONAKTIFKAN
 * (fail-closed, bukan fail-open).
 */
export function setupBullBoard(app: INestApplication): void {
  const logger = new Logger('BullBoard');

  const username = process.env.BULL_BOARD_USER || 'admin';
  const password = process.env.BULL_BOARD_PASSWORD;

  if (!password) {
    logger.warn('BULL_BOARD_PASSWORD tidak di-set — Bull Board dinonaktifkan (fail-closed)');
    return;
  }

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: ALL_QUEUES.map((name) => new BullMQAdapter(app.get<Queue>(getQueueToken(name)))),
    serverAdapter,
  });

  // HTTP Basic Auth middleware — dicek SEBELUM router Bull Board
  const basicAuth = (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');

    if (scheme === 'Basic' && encoded) {
      const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
      if (user === username && pass === password) {
        return next();
      }
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="MLV Bull Board"');
    res.status(401).send('Authentication required');
  };

  app.use('/admin/queues', basicAuth, serverAdapter.getRouter());
  logger.log('Bull Board aktif di /admin/queues (HTTP Basic Auth)');
}
