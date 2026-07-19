import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductionService } from './production.service';
import { OrderService } from '../../order/services/order.service';
import { CustomerService } from '../../customer/services/customer.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { ActorType, UserRole } from '@mlv/auth';

jest.mock('@mlv/db', () => ({
  prisma: {
    productionRouting: { findUnique: jest.fn(), findMany: jest.fn() },
    productionTask: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    orderItem: { findMany: jest.fn() },
    order: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

import { prisma } from '@mlv/db';

describe('ProductionService — Expanded Coverage', () => {
  let service: ProductionService;
  let mockOrderService: { addTimelineEvent: jest.Mock; getOrderByIdInternal: jest.Mock };
  let mockEventBus: { publish: jest.Mock };
  let mockActivityLog: { log: jest.Mock };

  const actorOwner = { sub: 'owner-1', role: 'OWNER' as UserRole, actorType: ActorType.USER };
  const actorManajer = {
    sub: 'mgr-1',
    role: 'MANAJER_PRODUKSI' as UserRole,
    actorType: ActorType.USER,
  };
  const actorPenjahit = {
    sub: 'pj-1',
    role: 'TIM_PENJAHIT' as UserRole,
    actorType: ActorType.USER,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOrderService = {
      addTimelineEvent: jest.fn().mockResolvedValue(undefined),
      getOrderByIdInternal: jest.fn(),
    };
    mockEventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    mockActivityLog = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionService,
        { provide: EventBusService, useValue: mockEventBus },
        { provide: OrderService, useValue: mockOrderService },
        {
          provide: CustomerService,
          useValue: {
            getCustomerByIdInternal: jest.fn().mockResolvedValue({
              id: 'cust-1',
              nama: 'Customer',
              noHp: '08123456789',
            }),
          },
        },
        { provide: ActivityLogService, useValue: mockActivityLog },
      ],
    }).compile();

    service = module.get<ProductionService>(ProductionService);
  });

  describe('handleOrderConfirmed', () => {
    it('should return early when no order items', async () => {
      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([]);
      await service.handleOrderConfirmed('order-1', 'MLV-0001', 'cust-1');
      expect(prisma.productionRouting.findUnique).not.toHaveBeenCalled();
    });

    it('should skip if order item already has tasks (idempotent)', async () => {
      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([
        { id: 'item-1', productType: 'KAOS', services: [] },
      ]);
      (prisma.productionRouting.findUnique as jest.Mock).mockResolvedValue({
        id: 'r-1',
        productType: 'KAOS',
        urutanTask: ['CUTTING', 'SEWING'],
      });
      (prisma.productionTask.findFirst as jest.Mock).mockResolvedValue({ id: 'existing-task' });
      await service.handleOrderConfirmed('order-1', 'MLV-0001', 'cust-1');
      expect(prisma.productionTask.create).not.toHaveBeenCalled();
    });

    it('should set first task to DITERIMA and rest to MENUNGGU', async () => {
      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([
        { id: 'item-1', productType: 'KAOS', services: [] },
      ]);
      (prisma.productionRouting.findUnique as jest.Mock).mockResolvedValue({
        id: 'r-1',
        productType: 'KAOS',
        urutanTask: ['CUTTING', 'SEWING', 'FINISHING'],
      });
      (prisma.productionTask.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.productionTask.create as jest.Mock).mockResolvedValue({ id: 'task-new' });
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));

      await service.handleOrderConfirmed('order-1', 'MLV-0001', 'cust-1');

      const calls = (prisma.productionTask.create as jest.Mock).mock.calls;
      expect(calls[0][0].data.status).toBe('DITERIMA');
      expect(calls[1][0].data.status).toBe('MENUNGGU');
      expect(calls[2][0].data.status).toBe('MENUNGGU');
    });

    it('should return early when routing not found', async () => {
      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([
        { id: 'item-1', productType: 'UNKNOWN', services: [] },
      ]);
      (prisma.productionRouting.findUnique as jest.Mock).mockResolvedValue(null);
      await service.handleOrderConfirmed('order-1', 'MLV-0001', 'cust-1');
      expect(prisma.productionTask.create).not.toHaveBeenCalled();
    });
  });

  describe('assignTask', () => {
    it('should throw ForbiddenException for non-Owner/Manajer', async () => {
      await expect(
        service.assignTask('task-1', { userId: 'pj-1' } as any, actorPenjahit),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when target user not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.assignTask('task-1', { userId: 'nonexistent' } as any, actorOwner),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when target user is not TIM_PENJAHIT', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1', role: 'OWNER' });
      await expect(
        service.assignTask('task-1', { userId: 'owner-1' } as any, actorOwner),
      ).rejects.toThrow(BadRequestException);
    });

    it('should assign task and publish event', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'pj-1',
        role: 'TIM_PENJAHIT',
        nama: 'Penjahit 1',
      });
      (prisma.productionTask.update as jest.Mock).mockResolvedValue({
        id: 'task-1',
        status: 'SEDANG_DILAKSANAKAN',
        orderItemId: 'item-1',
        taskType: 'SEWING',
        sequence: 1,
        startedAt: new Date(),
      });
      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue({
        id: 'task-1',
        orderItemId: 'item-1',
        taskType: 'SEWING',
        sequence: 1,
        status: 'SEDANG_DILAKSANAKAN',
        orderItem: { orderId: 'order-1', order: { orderNumber: 'MLV-0001' } },
      });

      await service.assignTask('task-1', { userId: 'pj-1' } as any, actorOwner);
      expect(mockEventBus.publish).toHaveBeenCalled();
      expect(mockActivityLog.log).toHaveBeenCalled();
    });
  });

  describe('updateTaskStatus - status validation', () => {
    it('should throw NotFoundException when task not found', async () => {
      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.updateTaskStatus('nonexistent', { status: 'SELESAI' } as any, actorOwner),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject transition from SELESAI (terminal state)', async () => {
      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue({
        id: 'task-1',
        status: 'SELESAI',
        assignedTo: 'pj-1',
        orderItem: { orderId: 'o-1', order: {} },
      });
      await expect(
        service.updateTaskStatus('task-1', { status: 'SEDANG_DILAKSANAKAN' } as any, actorOwner),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject MENUNGGU → SELESAI (must go through SEDANG_DILAKSANAKAN)', async () => {
      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue({
        id: 'task-1',
        status: 'MENUNGGU',
        assignedTo: 'pj-1',
        orderItem: { orderId: 'o-1', order: {} },
      });
      await expect(
        service.updateTaskStatus('task-1', { status: 'SELESAI' } as any, actorOwner),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow DITERIMA → SEDANG_DILAKSANAKAN', async () => {
      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue({
        id: 'task-1',
        orderItemId: 'item-1',
        taskType: 'CUTTING',
        sequence: 1,
        status: 'DITERIMA',
        assignedTo: 'pj-1',
        orderItem: { orderId: 'o-1', order: { orderNumber: 'MLV-0001' } },
      });
      (prisma.productionTask.update as jest.Mock).mockResolvedValue({
        id: 'task-1',
        status: 'SEDANG_DILAKSANAKAN',
      });
      await service.updateTaskStatus(
        'task-1',
        { status: 'SEDANG_DILAKSANAKAN' } as any,
        actorOwner,
      );
      expect(prisma.productionTask.update).toHaveBeenCalled();
    });

    it('should allow DITERIMA → SELESAI', async () => {
      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue({
        id: 'task-1',
        orderItemId: 'item-1',
        taskType: 'CUTTING',
        sequence: 1,
        status: 'DITERIMA',
        assignedTo: 'pj-1',
        orderItem: { orderId: 'o-1', order: { orderNumber: 'MLV-0001' } },
      });
      (prisma.productionTask.update as jest.Mock).mockResolvedValue({
        id: 'task-1',
        status: 'SELESAI',
        completedAt: new Date(),
      });
      (prisma.productionTask.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.productionTask.count as jest.Mock).mockResolvedValue(0);
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'o-1',
        orderNumber: 'MLV-0001',
        customerId: 'c-1',
        items: [{ id: 'item-1' }],
      });
      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([{ id: 'item-1' }]);

      await service.updateTaskStatus('task-1', { status: 'SELESAI' } as any, actorOwner);
      expect(prisma.productionTask.update).toHaveBeenCalled();
    });
  });

  describe('getOrderIdsForAssignee', () => {
    it('should return unique order IDs', async () => {
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([
        { orderItem: { orderId: 'o-1' } },
        { orderItem: { orderId: 'o-2' } },
        { orderItem: { orderId: 'o-1' } },
      ]);
      const result = await service.getOrderIdsForAssignee('pj-1');
      expect(result).toEqual(['o-1', 'o-2']);
    });

    it('should return empty array when no tasks', async () => {
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getOrderIdsForAssignee('pj-1');
      expect(result).toEqual([]);
    });
  });

  describe('getDesignRevisionEligibility', () => {
    it('should return eligibility map for order items', async () => {
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([
        { orderItemId: 'item-1', taskType: 'CUTTING', status: 'MENUNGGU' },
        { orderItemId: 'item-2', taskType: 'CUTTING', status: 'SELESAI' },
      ]);

      const result = await service.getDesignRevisionEligibility(['item-1', 'item-2']);
      expect(result['item-1'].allowed).toBe(true);
      expect(result['item-2'].allowed).toBe(false);
    });

    it('should return allowed=true when no cutting task found', async () => {
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getDesignRevisionEligibility(['item-1']);
      expect(result['item-1'].allowed).toBe(true);
    });
  });

  describe('assertDesignRevisionAllowed', () => {
    it('should throw when cutting has started (SELESAI)', async () => {
      // assertDesignRevisionAllowed calls getDesignRevisionEligibility which uses findMany
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([
        { orderItemId: 'item-1', status: 'SELESAI' },
      ]);
      await expect(service.assertDesignRevisionAllowed('item-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should pass when cutting has not started (no cutting task)', async () => {
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([]);
      await expect(service.assertDesignRevisionAllowed('item-1')).resolves.toBeUndefined();
    });

    it('should pass when cutting status is MENUNGGU', async () => {
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([
        { orderItemId: 'item-1', status: 'MENUNGGU' },
      ]);
      await expect(service.assertDesignRevisionAllowed('item-1')).resolves.toBeUndefined();
    });
  });

  describe('getTasks', () => {
    it('should return tasks with default filters', async () => {
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([
        { id: 'task-1', taskType: 'CUTTING', status: 'DITERIMA', orderItem: {} },
      ]);
      const result = await service.getTasks({});
      expect(result).toHaveLength(1);
    });

    it('should filter by status', async () => {
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([]);
      await service.getTasks({ status: 'SELESAI' });
      expect(prisma.productionTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'SELESAI' }) }),
      );
    });
  });

  describe('setQcStatus', () => {
    it('should throw NotFoundException when task not found', async () => {
      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.setQcStatus('nonexistent', { qcStatus: 'PASS' } as any, actorOwner),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when task is not SELESAI', async () => {
      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue({
        id: 'task-1',
        status: 'SEDANG_DILAKSANAKAN',
        orderItem: {},
      });
      await expect(
        service.setQcStatus('task-1', { qcStatus: 'PASS' } as any, actorOwner),
      ).rejects.toThrow(BadRequestException);
    });

    it('should set QC status for completed task', async () => {
      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue({
        id: 'task-1',
        status: 'SELESAI',
        orderItem: {},
      });
      (prisma.productionTask.update as jest.Mock).mockResolvedValue({
        id: 'task-1',
        qcStatus: 'PASS',
      });
      const result = await service.setQcStatus('task-1', { qcStatus: 'PASS' } as any, actorOwner);
      expect(result.qcStatus).toBe('PASS');
    });
  });

  describe('getAverageLeadTime', () => {
    it('should return null when no completed tasks', async () => {
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getAverageLeadTime(new Date(), new Date());
      expect(result).toBeNull();
    });

    it('should calculate average lead time in hours', async () => {
      const startedAt = new Date('2026-07-01T08:00:00Z');
      const completedAt = new Date('2026-07-02T08:00:00Z'); // 24 hours
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([
        {
          orderItemId: 'item-1',
          sequence: 1,
          startedAt,
          completedAt,
          orderItem: { orderId: 'o-1' },
        },
        {
          orderItemId: 'item-2',
          sequence: 1,
          startedAt,
          completedAt,
          orderItem: { orderId: 'o-2' },
        },
      ]);

      const result = await service.getAverageLeadTime(new Date(), new Date());
      expect(result).toBe(24);
    });
  });

  describe('getRejectRate', () => {
    it('should return zero rate when no QC tasks', async () => {
      // getRejectRate uses findMany (not count!) to get tasks with QC
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getRejectRate(new Date(), new Date());
      expect(result.total).toBe(0);
      expect(result.rejected).toBe(0);
      expect(result.rate).toBe(0);
    });

    it('should calculate reject rate from QC tasks', async () => {
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([
        { qcStatus: 'pass' },
        { qcStatus: 'pass' },
        { qcStatus: 'pass' },
        { qcStatus: 'reject' },
        { qcStatus: 'pass' },
      ]);

      const result = await service.getRejectRate(new Date(), new Date());
      expect(result.total).toBe(5);
      expect(result.rejected).toBe(1);
      expect(result.rate).toBe(0.2);
    });
  });

  describe('getProductionCostPerProduct', () => {
    it('should return cost map from routings', async () => {
      (prisma.productionRouting.findMany as jest.Mock).mockResolvedValue([
        { productType: 'Kaos', estimasiBiayaJahitPerPcs: 5000 },
        { productType: 'Kemeja', estimasiBiayaJahitPerPcs: 8000 },
        { productType: 'Hoodie', estimasiBiayaJahitPerPcs: 10000 },
        { productType: 'Topi', estimasiBiayaJahitPerPcs: 3000 },
        { productType: 'Tas', estimasiBiayaJahitPerPcs: 7000 },
      ]);

      const result = await service.getProductionCostPerProduct();
      expect(result['Kaos']).toBe(5000);
      expect(result['Kemeja']).toBe(8000);
    });

    it('should default to 0 when routing has null cost', async () => {
      (prisma.productionRouting.findMany as jest.Mock).mockResolvedValue([
        { productType: 'Kaos', estimasiBiayaJahitPerPcs: null },
      ]);

      const result = await service.getProductionCostPerProduct();
      expect(result['Kaos']).toBe(0);
    });
  });

  describe('getProductionContextForAi', () => {
    it('should return null when order not found', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue(null);
      const result = await service.getProductionContextForAi('nonexistent');
      expect(result).toBeNull();
    });

    it('should return production context with tasks', async () => {
      mockOrderService.getOrderByIdInternal.mockResolvedValue({
        orderNumber: 'MLV-0001',
        status: 'ANTREAN',
      });
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([
        {
          taskType: 'CUTTING',
          sequence: 1,
          status: 'SELESAI',
          assignedTo: 'pj-1',
          startedAt: new Date(),
          orderItem: { productType: 'Kaos' },
        },
        {
          taskType: 'SEWING',
          sequence: 2,
          status: 'SEDANG_DILAKSANAKAN',
          assignedTo: 'pj-2',
          startedAt: new Date(),
          orderItem: { productType: 'Kaos' },
        },
      ]);
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        { id: 'pj-1', nama: 'Penjahit 1' },
        { id: 'pj-2', nama: 'Penjahit 2' },
      ]);

      const result = await service.getProductionContextForAi('order-1');
      expect(result).not.toBeNull();
      expect(result!.orderNumber).toBe('MLV-0001');
      expect(result!.tasks).toHaveLength(2);
    });
  });
});
