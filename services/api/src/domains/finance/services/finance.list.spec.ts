import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FinanceService } from './finance.service';
import { OrderService } from '../../order/services/order.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { CustomerService } from '../../customer/services/customer.service';
import { AuthService } from '../../identity-access/services/auth.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { ActorType, UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';

// Mock prisma
jest.mock('@mlv/db', () => ({
  prisma: {
    payment: {
      findMany: jest.fn(),
    },
    invoice: {
      findMany: jest.fn(),
    },
    approval: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    profitSharing: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import { prisma } from '@mlv/db';

const OWNER: JwtPayload = {
  sub: 'user-owner',
  actorType: ActorType.USER,
  role: UserRole.OWNER,
  email: 'owner@mlv.dev',
};

const MANAJER: JwtPayload = {
  sub: 'user-manajer',
  actorType: ActorType.USER,
  role: UserRole.MANAJER_PRODUKSI,
  email: 'manajer@mlv.dev',
};

describe('FinanceService — Fase 9.3 (list & inbox approval)', () => {
  let service: FinanceService;
  let mockAuthService: { getUserByIdInternal: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockAuthService = {
      getUserByIdInternal: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve({ id, nama: id === 'user-owner' ? 'Owner MLV' : 'Manajer Produksi' }),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: EventBusService, useValue: { publish: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: OrderService, useValue: {} },
        { provide: InventoryService, useValue: {} },
        { provide: CustomerService, useValue: {} },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
  });

  describe('findPayments', () => {
    it('should filter by orderId when provided', async () => {
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([]);

      await service.findPayments('order-1');

      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
        include: { order: { select: { id: true, orderNumber: true, status: true } } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return all payments when no filter', async () => {
      (prisma.payment.findMany as jest.Mock).mockResolvedValue([{ id: 'pay-1' }]);

      const result = await service.findPayments();

      expect(result).toEqual([{ id: 'pay-1' }]);
      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });
  });

  describe('findInvoices', () => {
    it('should filter by orderId when provided', async () => {
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);

      await service.findInvoices('order-1');

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orderId: 'order-1' } }),
      );
    });
  });

  describe('getApprovals — RBAC §5.1', () => {
    const approvalRows = [
      {
        id: 'apr-1',
        tipe: 'DISKON',
        requestedBy: 'user-manajer',
        approvedBy: 'user-owner',
        status: 'APPROVED',
        order: null,
      },
    ];

    it('Owner: melihat SEMUA request (tanpa filter requestedBy)', async () => {
      (prisma.approval.findMany as jest.Mock).mockResolvedValue(approvalRows);

      await service.getApprovals(undefined, OWNER);

      const args = (prisma.approval.findMany as jest.Mock).mock.calls[0][0];
      expect(args.where.requestedBy).toBeUndefined();
    });

    it('Manajer: HANYA request miliknya sendiri (where.requestedBy = sub)', async () => {
      (prisma.approval.findMany as jest.Mock).mockResolvedValue([]);

      await service.getApprovals(undefined, MANAJER);

      const args = (prisma.approval.findMany as jest.Mock).mock.calls[0][0];
      expect(args.where.requestedBy).toBe('user-manajer');
    });

    it('meng-enrich nama pengaju & pemutus via AuthService (DDD §4.1)', async () => {
      (prisma.approval.findMany as jest.Mock).mockResolvedValue(approvalRows);

      const result = await service.getApprovals(undefined, OWNER);

      expect(result[0].requesterNama).toBe('Manajer Produksi');
      expect(result[0].approverNama).toBe('Owner MLV');
      expect(mockAuthService.getUserByIdInternal).toHaveBeenCalledWith('user-manajer');
      expect(mockAuthService.getUserByIdInternal).toHaveBeenCalledWith('user-owner');
    });

    it('meneruskan filter status ke query', async () => {
      (prisma.approval.findMany as jest.Mock).mockResolvedValue([]);

      await service.getApprovals('PENDING', OWNER);

      const args = (prisma.approval.findMany as jest.Mock).mock.calls[0][0];
      expect(args.where.status).toBe('PENDING');
    });
  });

  describe('createApproval — menyimpan orderId untuk konteks inbox', () => {
    it('should store orderId from dto', async () => {
      (prisma.approval.create as jest.Mock).mockResolvedValue({
        id: 'apr-baru',
        tipe: 'DISKON',
      });

      await service.createApproval(
        { tipe: 'DISKON', refId: 'order-1', orderId: 'order-1', alasan: 'Rp 50000' },
        MANAJER,
      );

      expect(prisma.approval.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ orderId: 'order-1', requestedBy: 'user-manajer' }),
      });
    });
  });

  describe('profit sharing — Owner-only (§5.1 tegas)', () => {
    it('Manajer GET → ForbiddenException', async () => {
      await expect(service.getProfitSharing(MANAJER)).rejects.toThrow(ForbiddenException);
    });

    it('Manajer CREATE → ForbiddenException', async () => {
      await expect(
        service.createProfitSharing({ pihak: 'manajer', persentase: 30 }, MANAJER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Owner GET → berhasil', async () => {
      (prisma.profitSharing.findMany as jest.Mock).mockResolvedValue([{ id: 'ps-1' }]);

      const result = await service.getProfitSharing(OWNER);

      expect(result).toEqual([{ id: 'ps-1' }]);
    });
  });
});
