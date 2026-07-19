import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
import { prisma } from '@mlv/db';

jest.mock('@mlv/db', () => ({
  prisma: {
    payment: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    invoice: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    approval: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    profitSharing: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    purchaseOrder: {
      aggregate: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
    },
  },
}));

// Mock global fetch for Midtrans calls
global.fetch = jest.fn();

describe('FinanceService — Comprehensive Tests', () => {
  let service: FinanceService;

  const mockEventBus = { publish: jest.fn() };
  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'MIDTRANS_SERVER_KEY') return 'test-server-key';
      if (key === 'MIDTRANS_IS_PRODUCTION') return 'false';
      return undefined;
    }),
  };
  const mockOrderService = {
    getOrderByIdInternal: jest.fn(),
    overrideItemPrice: jest.fn(),
    applyDiscount: jest.fn(),
    reissueInvoice: jest.fn(),
    releaseReservationsForOrder: jest.fn(),
    cancelOrderByFinance: jest.fn(),
  };
  const mockInventoryService = {};
  const mockCustomerService = {
    getCustomerByIdInternal: jest.fn(),
  };
  const mockAuthService = {
    getUserByIdInternal: jest.fn(),
  };
  const mockActivityLog = { log: jest.fn() };
  const mockInvoicePdfService = { generate: jest.fn() };

  const actorOwner = { sub: 'owner-1', role: 'OWNER', actorType: ActorType.USER } as any;
  const actorManajer = { sub: 'mgr-1', role: 'MANAJER_PRODUKSI', actorType: ActorType.USER } as any;
  const actorCustomer = { sub: 'cust-1', actorType: ActorType.CUSTOMER } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: EventBusService, useValue: mockEventBus },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: OrderService, useValue: mockOrderService },
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: CustomerService, useValue: mockCustomerService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: ActivityLogService, useValue: mockActivityLog },
        { provide: InvoicePdfService, useValue: mockInvoicePdfService },
      ],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
  });

  // ==========================================
  // createPayment tests
  // ==========================================
  describe('createPayment', () => {
    const baseOrder = {
      id: 'order-1',
      customerId: 'cust-1',
      status: 'MENUNGGU_PEMBAYARAN_DP',
      orderNumber: 'MLV-20260719-0001',
      discountNominal: 0,
      discountPersen: 0,
      items: [
        {
          productType: 'Kaos',
          basePriceSnapshot: 85000,
          sizes: [{ qty: 10 }],
          services: [],
        },
      ],
    };

    it('should throw NotFoundException when order not found', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createPayment(
          { orderId: 'nonexistent', jenis: 'DP', metode: 'midtrans_snap' } as any,
          actorOwner,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when customer accesses another customer order', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...baseOrder,
        customerId: 'other-customer',
      });

      await expect(
        service.createPayment(
          { orderId: 'order-1', jenis: 'DP', metode: 'midtrans_snap' } as any,
          actorCustomer,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when DP for non-MENUNGGU_PEMBAYARAN_DP order', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...baseOrder,
        status: 'DRAFT',
      });

      await expect(
        service.createPayment(
          { orderId: 'order-1', jenis: 'DP', metode: 'midtrans_snap' } as any,
          actorOwner,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when PELUNASAN for non-MENUNGGU_PELUNASAN order', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        ...baseOrder,
        status: 'MENUNGGU_PEMBAYARAN_DP',
      });

      await expect(
        service.createPayment(
          { orderId: 'order-1', jenis: 'PELUNASAN', metode: 'midtrans_snap' } as any,
          actorOwner,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when staff provides no jumlah', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(baseOrder);
      mockCustomerService.getCustomerByIdInternal.mockResolvedValue({ nama: 'Test' });

      await expect(
        service.createPayment(
          { orderId: 'order-1', jenis: 'DP', metode: 'midtrans_snap' } as any,
          actorOwner,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create payment for staff with explicit jumlah', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(baseOrder);
      mockCustomerService.getCustomerByIdInternal.mockResolvedValue({ nama: 'Test' });
      (prisma.payment.create as jest.Mock).mockResolvedValue({
        id: 'pay-1',
        orderId: 'order-1',
        jenis: 'DP',
        jumlah: 425000,
        status: 'PENDING',
      });
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.invoice.create as jest.Mock).mockResolvedValue({ id: 'inv-1' });

      const result = await service.createPayment(
        { orderId: 'order-1', jenis: 'DP', metode: 'manual', jumlah: 425000 } as any,
        actorOwner,
      );

      expect(result.payment).toBeDefined();
      expect(prisma.payment.create).toHaveBeenCalled();
    });

    it('should auto-calculate 50% DP for customer', async () => {
      (prisma.order.findUnique as jest.Mock)
        .mockResolvedValueOnce(baseOrder) // first call for order check
        .mockResolvedValueOnce(baseOrder); // second call for details
      mockCustomerService.getCustomerByIdInternal.mockResolvedValue({ nama: 'Customer' });
      (prisma.payment.create as jest.Mock).mockResolvedValue({
        id: 'pay-1',
        jumlah: 425000,
        status: 'PENDING',
      });
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.invoice.create as jest.Mock).mockResolvedValue({ id: 'inv-1' });
      // Mock fetch for Midtrans Snap call
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ token: 'snap-token', redirect_url: 'https://midtrans.com/pay' }),
      });

      const result = await service.createPayment(
        { orderId: 'order-1', jenis: 'DP', metode: 'midtrans_snap' } as any,
        actorCustomer,
      );

      // 10 * 85000 = 850000, 50% DP = 425000
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ jumlah: 425000 }),
        }),
      );
    });

    it('should throw BadRequestException when jumlah is 0 or negative', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(baseOrder);
      mockCustomerService.getCustomerByIdInternal.mockResolvedValue({ nama: 'Test' });

      await expect(
        service.createPayment(
          { orderId: 'order-1', jenis: 'DP', metode: 'manual', jumlah: 0 } as any,
          actorOwner,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==========================================
  // handleMidtransWebhook tests
  // ==========================================
  describe('handleMidtransWebhook', () => {
    it('should reject webhook with invalid signature', async () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'MIDTRANS_SERVER_KEY') return 'server-key';
        return undefined;
      });

      await expect(
        service.handleMidtransWebhook(
          { order_id: 'payment_1', status_code: '200', gross_amount: '100000' },
          'invalid-signature',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should ignore duplicate webhook (idempotency)', async () => {
      const crypto = require('crypto');
      const serverKey = 'server-key';
      const payload = {
        order_id: 'payment_pay-1',
        status_code: '200',
        gross_amount: '100000',
        transaction_id: 'txn-123',
        transaction_status: 'settlement',
      };
      const sig = crypto
        .createHash('sha512')
        .update(`${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`)
        .digest('hex');

      (mockConfigService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'MIDTRANS_SERVER_KEY') return serverKey;
        return undefined;
      });
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({ id: 'existing-pay' });

      await service.handleMidtransWebhook(payload, sig);

      // Should not update or publish
      expect(prisma.payment.update).not.toHaveBeenCalled();
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });

    it('should process settlement webhook and publish PaymentSucceeded', async () => {
      const crypto = require('crypto');
      const serverKey = 'server-key';
      const payload = {
        order_id: 'payment_pay-1',
        status_code: '200',
        gross_amount: '100000',
        transaction_id: 'txn-123',
        transaction_status: 'settlement',
      };
      const sig = crypto
        .createHash('sha512')
        .update(`${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`)
        .digest('hex');

      (mockConfigService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'MIDTRANS_SERVER_KEY') return serverKey;
        return undefined;
      });

      (prisma.payment.findFirst as jest.Mock).mockResolvedValue(null); // no duplicate
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue(null); // first call for idempotency
      (prisma.payment.update as jest.Mock).mockResolvedValue({});
      mockCustomerService.getCustomerByIdInternal.mockResolvedValue({
        nama: 'Customer',
        noHp: '08123456789',
      });

      // Mock findFirst for idempotency (null) then for payment lookup
      (prisma.payment.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // idempotency check
        .mockResolvedValueOnce({
          // payment lookup
          id: 'pay-1',
          orderId: 'order-1',
          jenis: 'DP',
          jumlah: 100000,
          midtransOrderId: 'payment_pay-1',
          order: { customerId: 'cust-1', orderNumber: 'MLV-0001' },
        });

      await service.handleMidtransWebhook(payload, sig);

      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.stringContaining('payment'),
        expect.objectContaining({}),
      );
    });
  });

  // ==========================================
  // getPaymentById tests
  // ==========================================
  describe('getPaymentById', () => {
    it('should return payment when found', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
        id: 'pay-1',
        orderId: 'order-1',
        order: {},
      });

      const result = await service.getPaymentById('pay-1');
      expect(result.id).toBe('pay-1');
    });

    it('should throw NotFoundException when payment not found', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getPaymentById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ==========================================
  // findPayments tests
  // ==========================================
  describe('findPayments', () => {
    it('should return payments for staff without ownership check', async () => {
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([{ id: 'pay-1' }]);

      const result = await service.findPayments('order-1', actorOwner);
      expect(result).toHaveLength(1);
    });

    it('should require orderId for customer', async () => {
      await expect(service.findPayments(undefined, actorCustomer)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ==========================================
  // findInvoices tests
  // ==========================================
  describe('findInvoices', () => {
    it('should return invoices for staff', async () => {
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([{ id: 'inv-1' }]);

      const result = await service.findInvoices('order-1', actorOwner);
      expect(result).toHaveLength(1);
    });

    it('should require orderId for customer', async () => {
      await expect(service.findInvoices(undefined, actorCustomer)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ==========================================
  // getInvoiceById tests
  // ==========================================
  describe('getInvoiceById', () => {
    it('should throw NotFoundException when invoice not found', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getInvoiceById('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when customer accesses another customer invoice', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv-1',
        order: { customerId: 'other-customer', items: [] },
      });

      await expect(service.getInvoiceById('inv-1', actorCustomer)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ==========================================
  // issueInvoice tests
  // ==========================================
  describe('issueInvoice', () => {
    it('should throw NotFoundException when invoice not found', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.issueInvoice('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when invoice is not DRAFT', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv-1',
        status: 'ISSUED',
        order: {},
      });

      await expect(service.issueInvoice('inv-1')).rejects.toThrow(BadRequestException);
    });

    it('should issue invoice and publish event', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv-1',
        status: 'DRAFT',
        orderId: 'order-1',
        jenis: 'DP',
        jumlah: 100000,
        order: { customerId: 'cust-1', orderNumber: 'MLV-0001' },
      });
      (prisma.invoice.update as jest.Mock).mockResolvedValue({
        id: 'inv-1',
        status: 'ISSUED',
        orderId: 'order-1',
        jenis: 'DP',
        jumlah: 100000,
      });
      mockCustomerService.getCustomerByIdInternal.mockResolvedValue({
        nama: 'Customer',
        noHp: '081234',
      });

      const result = await service.issueInvoice('inv-1');

      expect(result.status).toBe('ISSUED');
      expect(mockEventBus.publish).toHaveBeenCalled();
    });
  });

  // ==========================================
  // createApproval tests
  // ==========================================
  describe('createApproval', () => {
    it('should throw ForbiddenException for non-Manajer/Owner', async () => {
      const penjahit = { sub: 'pj-1', role: 'TIM_PENJAHIT' } as any;

      await expect(
        service.createApproval({ tipe: 'HARGA_KHUSUS', refId: 'item-1' } as any, penjahit),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should create approval for Manajer', async () => {
      (prisma.approval.create as jest.Mock).mockResolvedValue({
        id: 'approval-1',
        tipe: 'HARGA_KHUSUS',
      });
      mockAuthService.getUserByIdInternal.mockResolvedValue({ nama: 'Manager' });

      const result = await service.createApproval(
        { tipe: 'HARGA_KHUSUS', refId: 'item-1' } as any,
        actorManajer,
      );

      expect(result.id).toBe('approval-1');
      expect(mockEventBus.publish).toHaveBeenCalled();
    });

    it('should create approval for Owner', async () => {
      (prisma.approval.create as jest.Mock).mockResolvedValue({
        id: 'approval-2',
        tipe: 'DISKON',
      });
      mockAuthService.getUserByIdInternal.mockResolvedValue({ nama: 'Owner' });

      const result = await service.createApproval(
        { tipe: 'DISKON', refId: 'order-1' } as any,
        actorOwner,
      );

      expect(result.id).toBe('approval-2');
    });
  });

  // ==========================================
  // decideApproval tests
  // ==========================================
  describe('decideApproval', () => {
    it('should throw ForbiddenException for non-Owner', async () => {
      await expect(
        service.decideApproval('approval-1', { status: 'APPROVED' } as any, actorManajer),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when approval not found', async () => {
      (prisma.approval.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.decideApproval('nonexistent', { status: 'APPROVED' } as any, actorOwner),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when approval already processed', async () => {
      (prisma.approval.findUnique as jest.Mock).mockResolvedValue({
        id: 'approval-1',
        status: 'APPROVED',
      });

      await expect(
        service.decideApproval('approval-1', { status: 'APPROVED' } as any, actorOwner),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject approval without executing effect', async () => {
      (prisma.approval.findUnique as jest.Mock).mockResolvedValue({
        id: 'approval-1',
        tipe: 'HARGA_KHUSUS',
        status: 'PENDING',
        refId: 'item-1',
        orderId: 'order-1',
      });
      (prisma.approval.update as jest.Mock).mockResolvedValue({
        id: 'approval-1',
        status: 'REJECTED',
      });
      mockAuthService.getUserByIdInternal.mockResolvedValue({ nama: 'Owner' });

      const result = await service.decideApproval(
        'approval-1',
        { status: 'REJECTED', alasan: 'Too expensive' } as any,
        actorOwner,
      );

      expect(result.status).toBe('REJECTED');
      expect(mockOrderService.overrideItemPrice).not.toHaveBeenCalled();
      expect(mockActivityLog.log).toHaveBeenCalled();
      expect(mockEventBus.publish).toHaveBeenCalled();
    });

    it('should approve HARGA_KHUSUS and call overrideItemPrice', async () => {
      (prisma.approval.findUnique as jest.Mock).mockResolvedValue({
        id: 'approval-1',
        tipe: 'HARGA_KHUSUS',
        status: 'PENDING',
        refId: 'item-1',
        orderId: 'order-1',
      });
      (prisma.approval.update as jest.Mock).mockResolvedValue({
        id: 'approval-1',
        tipe: 'HARGA_KHUSUS',
        status: 'APPROVED',
      });
      mockAuthService.getUserByIdInternal.mockResolvedValue({ nama: 'Owner' });
      mockOrderService.overrideItemPrice.mockResolvedValue(undefined);

      await service.decideApproval(
        'approval-1',
        { status: 'APPROVED', alasan: 'Special price' } as any,
        actorOwner,
      );

      expect(mockOrderService.overrideItemPrice).toHaveBeenCalledWith('item-1', 'Special price');
    });

    it('should approve DISKON and call applyDiscount', async () => {
      (prisma.approval.findUnique as jest.Mock).mockResolvedValue({
        id: 'approval-2',
        tipe: 'DISKON',
        status: 'PENDING',
        refId: 'order-1',
        orderId: 'order-1',
      });
      (prisma.approval.update as jest.Mock).mockResolvedValue({
        id: 'approval-2',
        tipe: 'DISKON',
        status: 'APPROVED',
      });
      mockAuthService.getUserByIdInternal.mockResolvedValue({ nama: 'Owner' });
      mockOrderService.applyDiscount.mockResolvedValue(undefined);

      await service.decideApproval(
        'approval-2',
        { status: 'APPROVED', alasan: '10%' } as any,
        actorOwner,
      );

      expect(mockOrderService.applyDiscount).toHaveBeenCalledWith('order-1', '10%');
    });

    it('should approve EDIT_INVOICE and call reissueInvoice', async () => {
      (prisma.approval.findUnique as jest.Mock).mockResolvedValue({
        id: 'approval-3',
        tipe: 'EDIT_INVOICE',
        status: 'PENDING',
        refId: 'inv-1',
        orderId: 'order-1',
      });
      (prisma.approval.update as jest.Mock).mockResolvedValue({
        id: 'approval-3',
        tipe: 'EDIT_INVOICE',
        status: 'APPROVED',
      });
      mockAuthService.getUserByIdInternal.mockResolvedValue({ nama: 'Owner' });
      mockOrderService.reissueInvoice.mockResolvedValue(undefined);

      await service.decideApproval('approval-3', { status: 'APPROVED' } as any, actorOwner);

      expect(mockOrderService.reissueInvoice).toHaveBeenCalledWith('inv-1');
    });
  });

  // ==========================================
  // getApprovals tests
  // ==========================================
  describe('getApprovals', () => {
    it('should return all approvals for Owner', async () => {
      (prisma.approval.findMany as jest.Mock).mockResolvedValue([
        { id: 'a-1', requestedBy: 'mgr-1', approvedBy: null, order: null },
      ]);
      mockAuthService.getUserByIdInternal.mockResolvedValue({ nama: 'Manager' });

      const result = await service.getApprovals(undefined, actorOwner);

      expect(prisma.approval.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should filter by requestedBy for Manajer', async () => {
      (prisma.approval.findMany as jest.Mock).mockResolvedValue([]);
      mockAuthService.getUserByIdInternal.mockResolvedValue(null);

      await service.getApprovals(undefined, actorManajer);

      expect(prisma.approval.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { requestedBy: 'mgr-1' },
        }),
      );
    });

    it('should filter by status when provided', async () => {
      (prisma.approval.findMany as jest.Mock).mockResolvedValue([]);
      mockAuthService.getUserByIdInternal.mockResolvedValue(null);

      await service.getApprovals('PENDING', actorOwner);

      expect(prisma.approval.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PENDING' },
        }),
      );
    });
  });

  // ==========================================
  // Profit Sharing tests
  // ==========================================
  describe('createProfitSharing', () => {
    it('should throw ForbiddenException for non-Owner', async () => {
      await expect(service.createProfitSharing({} as any, actorManajer)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should create profit sharing for Owner', async () => {
      (prisma.profitSharing.create as jest.Mock).mockResolvedValue({ id: 'ps-1' });

      const result = await service.createProfitSharing(
        { pihak: 'Test', persen: 10 } as any,
        actorOwner,
      );
      expect(result.id).toBe('ps-1');
    });
  });

  describe('getProfitSharing', () => {
    it('should throw ForbiddenException for non-Owner', async () => {
      await expect(service.getProfitSharing(actorManajer)).rejects.toThrow(ForbiddenException);
    });

    it('should return list for Owner', async () => {
      (prisma.profitSharing.findMany as jest.Mock).mockResolvedValue([{ id: 'ps-1' }]);

      const result = await service.getProfitSharing(actorOwner);
      expect(result).toHaveLength(1);
    });
  });

  describe('updateProfitSharing', () => {
    it('should throw ForbiddenException for non-Owner', async () => {
      await expect(service.updateProfitSharing('ps-1', {} as any, actorManajer)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException when not found', async () => {
      (prisma.profitSharing.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateProfitSharing('nonexistent', {} as any, actorOwner),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update for Owner', async () => {
      (prisma.profitSharing.findUnique as jest.Mock).mockResolvedValue({ id: 'ps-1' });
      (prisma.profitSharing.update as jest.Mock).mockResolvedValue({ id: 'ps-1', persen: 15 });

      const result = await service.updateProfitSharing('ps-1', { persen: 15 } as any, actorOwner);
      expect(result.persen).toBe(15);
    });
  });

  describe('deleteProfitSharing', () => {
    it('should throw ForbiddenException for non-Owner', async () => {
      await expect(service.deleteProfitSharing('ps-1', actorManajer)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should delete for Owner', async () => {
      (prisma.profitSharing.delete as jest.Mock).mockResolvedValue({});

      await service.deleteProfitSharing('ps-1', actorOwner);
      expect(prisma.profitSharing.delete).toHaveBeenCalledWith({ where: { id: 'ps-1' } });
    });
  });

  // ==========================================
  // onProductionCompleted tests
  // ==========================================
  describe('onProductionCompleted', () => {
    it('should skip if PELUNASAN invoice already exists (idempotent)', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({ id: 'existing-inv' });

      await service.onProductionCompleted('order-1');

      expect(prisma.order.findUnique).not.toHaveBeenCalled();
    });

    it('should create PELUNASAN invoice when none exists', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        orderNumber: 'MLV-0001',
        items: [
          {
            basePriceSnapshot: 85000,
            sizes: [{ qty: 10 }],
            services: [],
          },
        ],
      });
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({ jumlah: 425000 });
      (prisma.invoice.create as jest.Mock).mockResolvedValue({ id: 'inv-pelunasan' });

      await service.onProductionCompleted('order-1');

      // subtotal = 85000 * 10 = 850000, pelunasan = 850000 - 425000 = 425000
      expect(prisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            jenis: 'PELUNASAN',
            jumlah: 425000,
          }),
        }),
      );
    });

    it('should skip when order not found', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await service.onProductionCompleted('nonexistent');

      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });

    it('should skip creating invoice when pelunasan amount is 0', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        orderNumber: 'MLV-0001',
        items: [
          {
            basePriceSnapshot: 85000,
            sizes: [{ qty: 10 }],
            services: [],
          },
        ],
      });
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({ jumlah: 850000 });

      await service.onProductionCompleted('order-1');

      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // Analytics methods tests
  // ==========================================
  describe('getRevenueByPeriod', () => {
    it('should aggregate revenue by month', async () => {
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([
        { jumlah: 100000, createdAt: new Date('2026-07-01') },
        { jumlah: 200000, createdAt: new Date('2026-07-15') },
        { jumlah: 150000, createdAt: new Date('2026-08-01') },
      ]);

      const result = await service.getRevenueByPeriod(
        new Date('2026-07-01'),
        new Date('2026-08-31'),
      );

      expect(result.total).toBe(450000);
      expect(result.byMonth).toHaveLength(2);
      expect(result.byMonth[0].month).toBe('2026-07');
      expect(result.byMonth[0].total).toBe(300000);
      expect(result.byMonth[1].month).toBe('2026-08');
      expect(result.byMonth[1].total).toBe(150000);
    });

    it('should return empty byMonth when no payments', async () => {
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getRevenueByPeriod(new Date(), new Date());

      expect(result.total).toBe(0);
      expect(result.byMonth).toHaveLength(0);
    });
  });

  describe('getMaterialCostsByPeriod', () => {
    it('should return sum of completed purchase orders', async () => {
      (prisma.purchaseOrder.aggregate as jest.Mock).mockResolvedValue({
        _sum: { totalBiaya: 500000 },
      });

      const result = await service.getMaterialCostsByPeriod(new Date(), new Date());
      expect(result).toBe(500000);
    });

    it('should return 0 when no purchase orders', async () => {
      (prisma.purchaseOrder.aggregate as jest.Mock).mockResolvedValue({
        _sum: { totalBiaya: null },
      });

      const result = await service.getMaterialCostsByPeriod(new Date(), new Date());
      expect(result).toBe(0);
    });
  });

  describe('getAverageOrderValue', () => {
    it('should calculate AOV from successful payments', async () => {
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([
        { orderId: 'o1', jumlah: 100000 },
        { orderId: 'o1', jumlah: 50000 },
        { orderId: 'o2', jumlah: 200000 },
      ]);

      const result = await service.getAverageOrderValue(new Date(), new Date());

      expect(result.totalRevenue).toBe(350000);
      expect(result.orderCount).toBe(2);
      expect(result.aov).toBe(175000);
    });

    it('should return 0 AOV when no payments', async () => {
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getAverageOrderValue(new Date(), new Date());

      expect(result.totalRevenue).toBe(0);
      expect(result.orderCount).toBe(0);
      expect(result.aov).toBe(0);
    });
  });
});
