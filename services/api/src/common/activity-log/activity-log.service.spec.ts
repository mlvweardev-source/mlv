import { ActivityLogService } from './activity-log.service';
import { prisma } from '@mlv/db';

jest.mock('@mlv/db', () => ({
  prisma: {
    activityLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

describe('ActivityLogService', () => {
  let service: ActivityLogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ActivityLogService();
  });

  describe('log', () => {
    it('should create an activity log entry', async () => {
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({ id: 'log-1' });

      await service.log('user-1', 'OWNER', 'Order dibuat', 'Order', 'order-1');

      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 'user-1',
          actorRole: 'OWNER',
          deskripsi: 'Order dibuat',
          entityType: 'Order',
          entityId: 'order-1',
        },
      });
    });

    it('should support null actorId for SYSTEM actions', async () => {
      (prisma.activityLog.create as jest.Mock).mockResolvedValue({ id: 'log-1' });

      await service.log(null, 'SYSTEM', 'Reservasi kadaluarsa', 'Order', 'order-1');

      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: {
          actorId: null,
          actorRole: 'SYSTEM',
          deskripsi: 'Reservasi kadaluarsa',
          entityType: 'Order',
          entityId: 'order-1',
        },
      });
    });

    it('should NOT throw when DB write fails (fail-safe)', async () => {
      (prisma.activityLog.create as jest.Mock).mockRejectedValue(new Error('DB connection lost'));

      // Should not throw
      await expect(
        service.log('user-1', 'OWNER', 'Test', 'Order', 'order-1'),
      ).resolves.toBeUndefined();
    });

    it('should log error message when DB write fails', async () => {
      const loggerSpy = jest.spyOn(service['logger'], 'error').mockImplementation();
      (prisma.activityLog.create as jest.Mock).mockRejectedValue(new Error('Connection timeout'));

      await service.log('user-1', 'OWNER', 'Test', 'Order', 'order-1');

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Gagal mencatat activity log'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('Connection timeout'));
      loggerSpy.mockRestore();
    });
  });

  describe('findAll', () => {
    it('should query with optional entityType filter', async () => {
      (prisma.activityLog.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll({ entityType: 'Order' });

      expect(prisma.activityLog.findMany).toHaveBeenCalledWith({
        where: { entityType: 'Order' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });

    it('should query with optional entityId filter', async () => {
      (prisma.activityLog.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll({ entityId: 'order-1' });

      expect(prisma.activityLog.findMany).toHaveBeenCalledWith({
        where: { entityId: 'order-1' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });

    it('should query with both filters', async () => {
      (prisma.activityLog.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll({ entityType: 'Order', entityId: 'order-1' });

      expect(prisma.activityLog.findMany).toHaveBeenCalledWith({
        where: { entityType: 'Order', entityId: 'order-1' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });

    it('should cap limit at 200', async () => {
      (prisma.activityLog.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll({ limit: 500 });

      expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('should default limit to 100 when not specified', async () => {
      (prisma.activityLog.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll({});

      expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('should use specified limit when under 200', async () => {
      (prisma.activityLog.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll({ limit: 50 });

      expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('should query without filters when empty query', async () => {
      (prisma.activityLog.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll({});

      expect(prisma.activityLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });
  });
});
