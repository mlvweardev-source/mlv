import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ActorType, UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { CustomerChatService } from './customer-chat.service';
import { AuthService } from '../../domains/identity-access/services/auth.service';
import { CustomerService } from '../../domains/customer/services/customer.service';
import { OrderService } from '../../domains/order/services/order.service';
import { FinanceService } from '../../domains/finance/services/finance.service';
import { ShippingService } from '../../domains/shipping/services/shipping.service';
import { AiAssistantService } from '../../domains/order/services/ai-assistant.service';

// Mock prisma — HANYA tabel milik domain ini sendiri (customerChatThread,
// customerChatMessage). TIDAK ada prisma.order / prisma.customer / prisma.payment
// / prisma.invoice / prisma.shipment karena CustomerChatService sekarang panggil
// service method masing-masing domain (DDD §4.1, koreksi Fase 12 Bagian 2).
jest.mock('@mlv/db', () => ({
  prisma: {
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
  let mockOrderService: { getOrderByIdInternal: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockOrderService = {
      // Fase 12 Bagian 2 (koreksi DDD §4.1): query ownership check
      // lewat OrderService, bukan prisma langsung
      getOrderByIdInternal: jest.fn().mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-a',
        status: 'ANTREAN',
        orderNumber: 'MLV-20260719-0001',
        alamat: null,
      }),
    };

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
          useValue: {
            getCustomerByIdInternal: jest.fn().mockResolvedValue(null),
            getCustomersByIdsInternal: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: OrderService,
          useValue: mockOrderService,
        },
        {
          // Fase 12 Bagian 2: FinanceService di-inject — default no-op
          provide: FinanceService,
          useValue: {
            getPaymentsForOrder: jest.fn().mockResolvedValue([]),
            getInvoicesForOrder: jest.fn().mockResolvedValue([]),
          },
        },
        {
          // Fase 12 Bagian 2: ShippingService di-inject — default no-op
          provide: ShippingService,
          useValue: {
            getShipmentForOrder: jest.fn().mockResolvedValue(null),
          },
        },
        {
          // Fase 12 Bagian 2: AI assistant service di-inject tapi
          // default no-op (tidak post auto-reply di test).
          provide: AiAssistantService,
          useValue: { answerCustomerQuestion: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();
    service = module.get<CustomerChatService>(CustomerChatService);
  });

  describe('validateAccess', () => {
    it('should allow customer A to access own order thread', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-a',
        status: 'ANTREAN',
        orderNumber: 'MLV-20260719-0001',
        alamat: null,
      });
      await expect(service.validateAccess('order-1', CUSTOMER_A)).resolves.toBeUndefined();
      // DDD §4.1: akses via OrderService, bukan prisma langsung
      expect(mockOrderService.getOrderByIdInternal).toHaveBeenCalledWith('order-1');
    });

    it('should deny customer B from accessing customer A order thread (403)', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-a',
        status: 'ANTREAN',
        orderNumber: 'MLV-20260719-0001',
        alamat: null,
      });
      await expect(service.validateAccess('order-1', CUSTOMER_B)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow Owner staff to access any order thread', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-a',
        status: 'ANTREAN',
        orderNumber: 'MLV-20260719-0001',
        alamat: null,
      });
      await expect(service.validateAccess('order-1', OWNER)).resolves.toBeUndefined();
    });

    it('should deny Tim Penjahit access to Customer Chat (defense-in-depth)', async () => {
      await expect(service.validateAccess('order-1', PENJAHIT)).rejects.toThrow(ForbiddenException);
      // Penjahit ditolak tanpa lookup — OrderService TIDAK dipanggil
      expect(mockOrderService.getOrderByIdInternal).not.toHaveBeenCalled();
    });

    it('should throw NotFound when order does not exist', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue(null);
      await expect(service.validateAccess('order-x', CUSTOMER_A)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('sendMessage — senderType derivation', () => {
    beforeEach(() => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-a',
        status: 'ANTREAN',
        orderNumber: 'MLV-20260719-0001',
        alamat: null,
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
