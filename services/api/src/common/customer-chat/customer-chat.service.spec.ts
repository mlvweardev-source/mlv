import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ActorType, UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { CustomerChatService } from './customer-chat.service';
import { AuthService } from '../../domains/identity-access/services/auth.service';
import { CustomerService } from '../../domains/customer/services/customer.service';

// Mock prisma
jest.mock('@mlv/db', () => ({
  prisma: {
    order: {
      findUnique: jest.fn(),
    },
    customer: {
      findMany: jest.fn(),
    },
    customerChatThread: {
      upsert: jest.fn(),
    },
    customerChatMessage: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import { prisma } from '@mlv/db';

const CUSTOMER_A: JwtPayload = {
  sub: 'cust-a',
  actorType: ActorType.CUSTOMER,
  email: 'cust-a@mlv.dev',
};

const CUSTOMER_B: JwtPayload = {
  sub: 'cust-b',
  actorType: ActorType.CUSTOMER,
  email: 'cust-b@mlv.dev',
};

const OWNER: JwtPayload = {
  sub: 'staff-owner',
  actorType: ActorType.USER,
  role: UserRole.OWNER,
  email: 'owner@mlv.dev',
};

const PENJAHIT: JwtPayload = {
  sub: 'staff-penjahit',
  actorType: ActorType.USER,
  role: UserRole.TIM_PENJAHIT,
  email: 'penjahit@mlv.dev',
};

describe('CustomerChatService — RBAC & Sender Type', () => {
  let service: CustomerChatService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerChatService,
        {
          provide: AuthService,
          useValue: {
            getUsersByIdsInternal: jest.fn().mockResolvedValue([]),
            getUserByIdInternal: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: CustomerService,
          useValue: { getCustomerByIdInternal: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();
    service = module.get<CustomerChatService>(CustomerChatService);
  });

  describe('validateAccess', () => {
    it('should allow customer A to access own order thread', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-a',
      });
      await expect(service.validateAccess('order-1', CUSTOMER_A)).resolves.toBeUndefined();
    });

    it('should deny customer B from accessing customer A order thread (403)', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-a',
      });
      await expect(service.validateAccess('order-1', CUSTOMER_B)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow Owner staff to access any order thread', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-a',
      });
      await expect(service.validateAccess('order-1', OWNER)).resolves.toBeUndefined();
    });

    it('should deny Tim Penjahit access to Customer Chat (defense-in-depth)', async () => {
      await expect(service.validateAccess('order-1', PENJAHIT)).rejects.toThrow(ForbiddenException);
      // Even if order exists, penjahit must be rejected without DB lookup
      expect(prisma.order.findUnique).not.toHaveBeenCalled();
    });

    it('should throw NotFound when order does not exist', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.validateAccess('order-x', CUSTOMER_A)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('sendMessage — senderType derivation', () => {
    beforeEach(() => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-a',
      });
      (prisma.customerChatThread.upsert as jest.Mock).mockResolvedValue({
        id: 'thread-1',
        orderId: 'order-1',
        customerId: 'cust-a',
        createdAt: new Date(),
      });
    });

    it('should set senderType="customer" when actor is CUSTOMER', async () => {
      (prisma.customerChatMessage.create as jest.Mock).mockResolvedValue({
        id: 'msg-1',
        senderId: 'cust-a',
        senderType: 'customer',
        pesan: 'Halo admin',
        createdAt: new Date(),
      });
      const result = await service.sendMessage('order-1', CUSTOMER_A, 'Halo admin');
      expect(prisma.customerChatMessage.create).toHaveBeenCalledWith({
        data: {
          threadId: 'thread-1',
          senderType: 'customer',
          senderId: 'cust-a',
          pesan: 'Halo admin',
        },
      });
      expect(result.senderType).toBe('customer');
    });

    it('should set senderType="admin" when actor is staff USER', async () => {
      (prisma.customerChatMessage.create as jest.Mock).mockResolvedValue({
        id: 'msg-2',
        senderId: 'staff-owner',
        senderType: 'admin',
        pesan: 'Halo budi',
        createdAt: new Date(),
      });
      const result = await service.sendMessage('order-1', OWNER, 'Halo budi');
      expect(prisma.customerChatMessage.create).toHaveBeenCalledWith({
        data: {
          threadId: 'thread-1',
          senderType: 'admin',
          senderId: 'staff-owner',
          pesan: 'Halo budi',
        },
      });
      expect(result.senderType).toBe('admin');
    });
  });
});
