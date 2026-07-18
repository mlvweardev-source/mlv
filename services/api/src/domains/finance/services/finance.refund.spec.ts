import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FinanceService } from './finance.service';
import { OrderService } from '../../order/services/order.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { CustomerService } from '../../customer/services/customer.service';
import { AuthService } from '../../identity-access/services/auth.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { InvoicePdfService } from './invoice-pdf.service';

// Mock prisma
jest.mock('@mlv/db', () => ({
  prisma: {
    order: {
      findUnique: jest.fn(),
    },
    payment: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    approval: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    invoice: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    stockReservation: {
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from '@mlv/db';

describe('FinanceService - Refund API', () => {
  let service: FinanceService;
  let mockOrderService: any;
  let mockInventoryService: any;
  let mockCustomerService: any;
  let mockAuthService: any;
  let mockEventBus: any;
  let mockConfigService: any;

  const mockServerKey = 'test-server-key-12345';

  beforeEach(async () => {
    jest.clearAllMocks();

    mockOrderService = {
      releaseReservationsForOrder: jest.fn().mockResolvedValue(1),
      cancelOrderByFinance: jest.fn().mockResolvedValue(undefined),
    };

    mockInventoryService = {
      releaseStock: jest.fn().mockResolvedValue(undefined),
    };

    mockCustomerService = {
      getCustomerByIdInternal: jest.fn().mockResolvedValue({
        id: 'customer-789',
        nama: 'Budi Santoso',
        noHp: '+628123456789',
      }),
    };

    mockAuthService = {
      getUserByIdInternal: jest.fn().mockResolvedValue({
        id: 'user-1',
        nama: 'Owner MLV',
        role: 'OWNER',
      }),
    };

    mockEventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'MIDTRANS_SERVER_KEY') return mockServerKey;
        if (key === 'MIDTRANS_IS_PRODUCTION') return 'false';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: EventBusService, useValue: mockEventBus },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: OrderService, useValue: mockOrderService },
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: CustomerService, useValue: mockCustomerService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: ActivityLogService, useValue: { log: jest.fn() } },
        { provide: InvoicePdfService, useValue: { generate: jest.fn() } },
      ],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
  });

  describe('executeApprovalEffect - REFUND', () => {
    it('should call Midtrans refund API before internal effects', async () => {
      // Setup: approval for REFUND
      const approval = {
        id: 'approval-1',
        tipe: 'REFUND',
        refId: 'order-1',
        orderId: 'order-1',
        status: 'PENDING',
      };

      // Payment exists and is SUCCESS
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
        id: 'payment-1',
        orderId: 'order-1',
        status: 'SUCCESS',
        midtransOrderId: 'payment_payment-1',
        jumlah: 100000,
      });

      // Mock fetch for Midtrans refund API
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status_code: '200', status_message: 'Success' }),
      });
      global.fetch = mockFetch;

      // Call the private method via decideApproval
      (prisma.approval.findUnique as jest.Mock).mockResolvedValue(approval);
      (prisma.approval.update as jest.Mock).mockResolvedValue({
        ...approval,
        status: 'APPROVED',
        decidedAt: new Date(),
      });

      await service.decideApproval(
        'approval-1',
        { status: 'APPROVED', alasan: 'Customer minta refund' },
        { sub: 'user-1', role: 'OWNER', actorType: 'USER' } as any,
      );

      // Verify Midtrans refund API was called
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v2/payment_payment-1/refund'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Basic'),
          }),
        }),
      );

      // Verify internal effects ran
      expect(mockOrderService.releaseReservationsForOrder).toHaveBeenCalledWith('order-1');
      expect(mockOrderService.cancelOrderByFinance).toHaveBeenCalledWith(
        'order-1',
        'Customer minta refund',
      );

      // Verify payment status updated
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payment-1' },
          data: { status: 'SUCCESS' },
        }),
      );

      // Cleanup
      global.fetch = undefined as any;
    });

    it('should fail and not run internal effects when Midtrans refund API fails', async () => {
      const approval = {
        id: 'approval-1',
        tipe: 'REFUND',
        refId: 'order-1',
        orderId: 'order-1',
        status: 'PENDING',
      };

      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
        id: 'payment-1',
        orderId: 'order-1',
        status: 'SUCCESS',
        midtransOrderId: 'payment_payment-1',
        jumlah: 100000,
      });

      // Mock fetch to return error
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('{"error_messages":["Transaction not found"]}'),
      });
      global.fetch = mockFetch;

      (prisma.approval.findUnique as jest.Mock).mockResolvedValue(approval);
      (prisma.approval.update as jest.Mock).mockResolvedValue({
        ...approval,
        status: 'APPROVED',
        decidedAt: new Date(),
      });

      await expect(
        service.decideApproval(
          'approval-1',
          { status: 'APPROVED', alasan: 'Customer minta refund' },
          { sub: 'user-1', role: 'OWNER', actorType: 'USER' } as any,
        ),
      ).rejects.toThrow(BadRequestException);

      // Internal effects should NOT have been called
      expect(mockOrderService.releaseReservationsForOrder).not.toHaveBeenCalled();
      expect(mockOrderService.cancelOrderByFinance).not.toHaveBeenCalled();

      // Cleanup
      global.fetch = undefined as any;
    });

    it('should fail when no successful payment exists for order', async () => {
      const approval = {
        id: 'approval-1',
        tipe: 'REFUND',
        refId: 'order-1',
        orderId: 'order-1',
        status: 'PENDING',
      };

      // No successful payment
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue(null);

      (prisma.approval.findUnique as jest.Mock).mockResolvedValue(approval);
      (prisma.approval.update as jest.Mock).mockResolvedValue({
        ...approval,
        status: 'APPROVED',
        decidedAt: new Date(),
      });

      await expect(
        service.decideApproval(
          'approval-1',
          { status: 'APPROVED', alasan: 'Customer minta refund' },
          { sub: 'user-1', role: 'OWNER', actorType: 'USER' } as any,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockOrderService.releaseReservationsForOrder).not.toHaveBeenCalled();
    });

    it('should update payment to FAILED when Midtrans refund API returns error', async () => {
      const approval = {
        id: 'approval-1',
        tipe: 'REFUND',
        refId: 'order-1',
        orderId: 'order-1',
        status: 'PENDING',
      };

      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
        id: 'payment-1',
        orderId: 'order-1',
        status: 'SUCCESS',
        midtransOrderId: 'payment_payment-1',
      });

      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Refund rejected'),
      });
      global.fetch = mockFetch;

      (prisma.approval.findUnique as jest.Mock).mockResolvedValue(approval);
      (prisma.approval.update as jest.Mock).mockResolvedValue({
        ...approval,
        status: 'APPROVED',
        decidedAt: new Date(),
      });

      await expect(
        service.decideApproval('approval-1', { status: 'APPROVED' }, {
          sub: 'user-1',
          role: 'OWNER',
          actorType: 'USER',
        } as any),
      ).rejects.toThrow();

      // Payment should be marked FAILED
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payment-1' },
          data: { status: 'FAILED' },
        }),
      );

      // Cleanup
      global.fetch = undefined as any;
    });
  });
});
