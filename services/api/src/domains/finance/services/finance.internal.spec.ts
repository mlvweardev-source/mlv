import { Test, TestingModule } from '@nestjs/testing';
import { FinanceService } from './finance.service';
import { OrderService } from '../../order/services/order.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { CustomerService } from '../../customer/services/customer.service';
import { AuthService } from '../../identity-access/services/auth.service';
import { ConfigService } from '@nestjs/config';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { InvoicePdfService } from './invoice-pdf.service';

// Mock prisma
jest.mock('@mlv/db', () => ({
  prisma: {
    payment: { findMany: jest.fn() },
    invoice: { findMany: jest.fn() },
  },
}));

import { prisma } from '@mlv/db';

/**
 * Fase 12 Bagian 2 (koreksi DDD §4.1):
 * Unit test untuk method internal FinanceService yang dipanggil
 * lintas DOMAIN dalam SATU proses (CustomerChatService → FinanceService).
 *
 * Beda dengan endpoint publik (findPayments, findInvoices) yang
 * return data + RBAC check — method `get*ForOrder` return data
 * minimal untuk caller lain, tanpa RBAC (caller sudah validate).
 */
describe('FinanceService — Cross-Domain Internal Methods (Fase 12 Bagian 2)', () => {
  let service: FinanceService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: OrderService, useValue: {} },
        { provide: InventoryService, useValue: {} },
        { provide: CustomerService, useValue: {} },
        { provide: AuthService, useValue: { getUserByIdInternal: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        { provide: EventBusService, useValue: { publish: jest.fn() } },
        { provide: ActivityLogService, useValue: { log: jest.fn() } },
        { provide: InvoicePdfService, useValue: { generate: jest.fn() } },
      ],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
  });

  describe('getPaymentsForOrder', () => {
    it('should query payment with minimal fields by orderId', async () => {
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'pay-1',
          jenis: 'DP',
          jumlah: 1000000,
          status: 'SUCCESS',
          createdAt: new Date('2026-07-19'),
        },
        {
          id: 'pay-2',
          jenis: 'PELUNASAN',
          jumlah: 1500000,
          status: 'PENDING',
          createdAt: new Date('2026-07-25'),
        },
      ]);

      const result = await service.getPaymentsForOrder('order-1');

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
        select: {
          id: true,
          jenis: true,
          jumlah: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(2);
      expect(result[0].jenis).toBe('DP');
      expect(result[1].jenis).toBe('PELUNASAN');
    });

    it('should return empty array when no payments exist', async () => {
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getPaymentsForOrder('order-no-payments');
      expect(result).toEqual([]);
    });
  });

  describe('getInvoicesForOrder', () => {
    it('should query invoice with minimal fields by orderId', async () => {
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        { id: 'inv-1', jenis: 'DP', jumlah: 1000000, status: 'PAID' },
        { id: 'inv-2', jenis: 'PELUNASAN', jumlah: 1500000, status: 'ISSUED' },
      ]);

      const result = await service.getInvoicesForOrder('order-1');

      expect(prisma.invoice.findMany).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
        select: {
          id: true,
          jenis: true,
          jumlah: true,
          status: true,
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no invoices exist', async () => {
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getInvoicesForOrder('order-no-invoices');
      expect(result).toEqual([]);
    });
  });
});
