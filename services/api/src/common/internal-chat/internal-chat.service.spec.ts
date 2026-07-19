import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { InternalChatService } from './internal-chat.service';
import { AuthService } from '../../domains/identity-access/services/auth.service';
import { prisma } from '@mlv/db';
import { UserRole, ActorType } from '@mlv/auth';

jest.mock('@mlv/db', () => ({
  prisma: {
    productionTask: { findMany: jest.fn() },
    internalChatThread: { upsert: jest.fn() },
    internalChatMessage: { findMany: jest.fn(), create: jest.fn() },
  },
}));

describe('InternalChatService', () => {
  let service: InternalChatService;
  const mockAuthService = {
    getUsersByIdsInternal: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InternalChatService,
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    service = module.get<InternalChatService>(InternalChatService);
  });

  describe('validateAccess', () => {
    const ownerUser = { sub: 'owner-1', role: UserRole.OWNER } as any;
    const manajerUser = { sub: 'mgr-1', role: UserRole.MANAJER_PRODUKSI } as any;
    const penjahitUser = { sub: 'pj-1', role: UserRole.TIM_PENJAHIT } as any;

    it('should allow Owner without any DB check', async () => {
      await service.validateAccess('order-1', ownerUser);
      expect(prisma.productionTask.findMany).not.toHaveBeenCalled();
    });

    it('should allow Manajer without any DB check', async () => {
      await service.validateAccess('order-1', manajerUser);
      expect(prisma.productionTask.findMany).not.toHaveBeenCalled();
    });

    it('should allow Penjahit with assigned tasks', async () => {
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([{ id: 'task-1' }]);

      await service.validateAccess('order-1', penjahitUser);

      expect(prisma.productionTask.findMany).toHaveBeenCalledWith({
        where: { assignedTo: 'pj-1', orderItem: { orderId: 'order-1' } },
        take: 1,
      });
    });

    it('should deny Penjahit without assigned tasks', async () => {
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([]);

      await expect(service.validateAccess('order-1', penjahitUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getOrCreateThread', () => {
    it('should upsert thread and return messages with sender names', async () => {
      const mockThread = { id: 'thread-1', orderId: 'order-1', createdAt: new Date() };
      const mockMessages = [
        {
          id: 'msg-1',
          senderId: 'user-1',
          pesan: 'Hello',
          createdAt: new Date(),
          thread: { order: { orderNumber: 'MLV-20260719-0001' } },
        },
        {
          id: 'msg-2',
          senderId: 'user-2',
          pesan: 'Hi there',
          createdAt: new Date(),
          thread: { order: { orderNumber: 'MLV-20260719-0001' } },
        },
      ];

      (prisma.internalChatThread.upsert as jest.Mock).mockResolvedValue(mockThread);
      (prisma.internalChatMessage.findMany as jest.Mock).mockResolvedValue(mockMessages);
      mockAuthService.getUsersByIdsInternal.mockResolvedValue([
        { id: 'user-1', nama: 'Alice' },
        { id: 'user-2', nama: 'Bob' },
      ]);

      const result = await service.getOrCreateThread('order-1');

      expect(result.id).toBe('thread-1');
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].senderNama).toBe('Alice');
      expect(result.messages[1].senderNama).toBe('Bob');
      expect(result.orderNumber).toBe('MLV-20260719-0001');
    });

    it('should handle empty messages', async () => {
      const mockThread = { id: 'thread-1', orderId: 'order-1', createdAt: new Date() };
      (prisma.internalChatThread.upsert as jest.Mock).mockResolvedValue(mockThread);
      (prisma.internalChatMessage.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getOrCreateThread('order-1');

      expect(result.messages).toHaveLength(0);
      expect(result.orderNumber).toBe('');
      expect(mockAuthService.getUsersByIdsInternal).not.toHaveBeenCalled();
    });

    it('should use senderId as fallback when user not found', async () => {
      const mockThread = { id: 'thread-1', orderId: 'order-1', createdAt: new Date() };
      (prisma.internalChatThread.upsert as jest.Mock).mockResolvedValue(mockThread);
      (prisma.internalChatMessage.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'msg-1',
          senderId: 'unknown-user',
          pesan: 'test',
          createdAt: new Date(),
          thread: { order: { orderNumber: 'MLV-0001' } },
        },
      ]);
      mockAuthService.getUsersByIdsInternal.mockResolvedValue([]);

      const result = await service.getOrCreateThread('order-1');

      expect(result.messages[0].senderNama).toBe('unknown-user');
    });
  });

  describe('sendMessage', () => {
    it('should create message and push to SSE subscribers', async () => {
      const mockThread = { id: 'thread-1', orderId: 'order-1' };
      const mockMessage = {
        id: 'msg-1',
        senderId: 'user-1',
        pesan: 'Hello',
        createdAt: new Date(),
      };

      (prisma.internalChatThread.upsert as jest.Mock).mockResolvedValue(mockThread);
      (prisma.internalChatMessage.create as jest.Mock).mockResolvedValue(mockMessage);

      const received: any[] = [];
      service.subscribe('thread-1', (msg) => received.push(msg));

      const result = await service.sendMessage('order-1', 'user-1', 'Alice', 'Hello');

      expect(result.senderNama).toBe('Alice');
      expect(result.pesan).toBe('Hello');
      expect(received).toHaveLength(1);
      expect(received[0].senderNama).toBe('Alice');
    });

    it('should handle subscriber callback errors silently', async () => {
      const mockThread = { id: 'thread-1', orderId: 'order-1' };
      const mockMessage = {
        id: 'msg-1',
        senderId: 'user-1',
        pesan: 'test',
        createdAt: new Date(),
      };

      (prisma.internalChatThread.upsert as jest.Mock).mockResolvedValue(mockThread);
      (prisma.internalChatMessage.create as jest.Mock).mockResolvedValue(mockMessage);

      // Subscribe with a callback that throws
      service.subscribe('thread-1', () => {
        throw new Error('client disconnected');
      });

      // Should not throw
      const result = await service.sendMessage('order-1', 'user-1', 'Alice', 'test');
      expect(result).toBeDefined();
    });
  });

  describe('subscribe', () => {
    it('should add and remove subscribers', () => {
      const callback = jest.fn();
      const unsubscribe = service.subscribe('thread-1', callback);

      // Send a message to trigger the subscriber
      const mockThread = { id: 'thread-1', orderId: 'order-1' };
      const mockMessage = {
        id: 'msg-1',
        senderId: 'user-1',
        pesan: 'test',
        createdAt: new Date(),
      };
      (prisma.internalChatThread.upsert as jest.Mock).mockResolvedValue(mockThread);
      (prisma.internalChatMessage.create as jest.Mock).mockResolvedValue(mockMessage);

      // After unsubscribe, callback should not be called
      unsubscribe();

      return service.sendMessage('order-1', 'user-1', 'Alice', 'test').then(() => {
        expect(callback).not.toHaveBeenCalled();
      });
    });

    it('should handle multiple subscribers for same thread', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      const unsub1 = service.subscribe('thread-1', cb1);
      const unsub2 = service.subscribe('thread-1', cb2);

      unsub1();
      // cb2 should still be registered
      unsub2();
    });
  });
});
