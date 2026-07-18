import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FinanceService } from './finance.service';
import { OrderService } from '../../order/services/order.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { CustomerService } from '../../customer/services/customer.service';
import { AuthService } from '../../identity-access/services/auth.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { ActorType, UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';

// Mock prisma
jest.mock('@mlv/db', () => ({
  prisma: {
    order: {
      findUnique: jest.fn(),
    },
    customer: {
      findUnique: jest.fn(),
    },
    payment: {
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    invoice: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
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

describe('FinanceService — Customer Payment RBAC & Calculation', () => {
  let service: FinanceService;
  let mockCustomerService: { getCustomerByIdInternal: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockCustomerService = {
      getCustomerByIdInternal: jest.fn().mockResolvedValue({ id: 'cust-a', nama: 'Budi' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: EventBusService, useValue: { publish: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: OrderService, useValue: {} },
        { provide: InventoryService, useValue: {} },
        { provide: CustomerService, useValue: mockCustomerService },
        { provide: AuthService, useValue: {} },
        { provide: ActivityLogService, useValue: { log: jest.fn() } },
        { provide: InvoicePdfService, useValue: { generate: jest.fn() } },
      ],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
  });

  describe('createPayment for Customer', () => {
    it('should allow customer A to pay for customer A order with automatically calculated 50% DP', async () => {
      const mockOrder = {
        id: 'order-1',
        customerId: 'cust-a',
        orderNumber: 'MLV-20260718-0001',
        status: 'MENUNGGU_PEMBAYARAN_DP',
        items: [
          {
            basePriceSnapshot: 100000,
            sizes: [{ qty: 2 }],
            services: [],
          },
        ],
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.payment.create as jest.Mock).mockResolvedValue({ id: 'pay-1', jumlah: 100000 });
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.invoice.create as jest.Mock).mockResolvedValue({ id: 'inv-1' });

      const result = await service.createPayment(
        { orderId: 'order-1', jenis: 'DP', metode: 'transfer' },
        CUSTOMER_A,
      );

      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: {
          orderId: 'order-1',
          jenis: 'DP',
          metode: 'transfer',
          jumlah: 100000, // 50% of 200,000 = 100,000
          status: 'PENDING',
        },
      });
    });

    it('should deny customer B to pay for customer A order', async () => {
      const mockOrder = {
        id: 'order-1',
        customerId: 'cust-a',
        status: 'MENUNGGU_PEMBAYARAN_DP',
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

      await expect(
        service.createPayment(
          { orderId: 'order-1', jenis: 'DP', metode: 'transfer' },
          CUSTOMER_B,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should deny DP payment if order is not in MENUNGGU_PEMBAYARAN_DP status', async () => {
      const mockOrder = {
        id: 'order-1',
        customerId: 'cust-a',
        status: 'DRAFT',
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

      await expect(
        service.createPayment(
          { orderId: 'order-1', jenis: 'DP', metode: 'transfer' },
          CUSTOMER_A,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should deny Pelunasan payment if order is not in MENUNGGU_PELUNASAN status', async () => {
      const mockOrder = {
        id: 'order-1',
        customerId: 'cust-a',
        status: 'ANTREAN',
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

      await expect(
        service.createPayment(
          { orderId: 'order-1', jenis: 'PELUNASAN', metode: 'transfer' },
          CUSTOMER_A,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow Pelunasan payment if order is in MENUNGGU_PELUNASAN status', async () => {
      const mockOrder = {
        id: 'order-1',
        customerId: 'cust-a',
        orderNumber: 'MLV-20260718-0001',
        status: 'MENUNGGU_PELUNASAN',
        items: [
          {
            basePriceSnapshot: 100000,
            sizes: [{ qty: 2 }],
            services: [],
          },
        ],
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.payment.create as jest.Mock).mockResolvedValue({ id: 'pay-2', jumlah: 100000 });
      (prisma.payment.aggregate as jest.Mock).mockResolvedValue({ _sum: { jumlah: 100000 } });
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.invoice.create as jest.Mock).mockResolvedValue({ id: 'inv-2' });

      const result = await service.createPayment(
        { orderId: 'order-1', jenis: 'PELUNASAN', metode: 'transfer' },
        CUSTOMER_A,
      );

      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: {
          orderId: 'order-1',
          jenis: 'PELUNASAN',
          metode: 'transfer',
          jumlah: 100000, // 200,000 - 100,000 (paid DP) = 100,000
          status: 'PENDING',
        },
      });
    });
  });
});
