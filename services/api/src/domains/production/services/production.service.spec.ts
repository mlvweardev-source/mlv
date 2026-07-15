import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ProductionService } from './production.service';
import { OrderService } from '../../order/services/order.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { ActorType, UserRole } from '@mlv/auth';

// Mock @mlv/db - all inline to avoid hoisting issues
jest.mock('@mlv/db', () => ({
  prisma: {
    productionRouting: {
      findUnique: jest.fn(),
    },
    productionTask: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    orderItem: {
      findMany: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

// Import after mock
import { prisma } from '@mlv/db';

describe('ProductionService', () => {
  let service: ProductionService;
  let mockOrderService: { addTimelineEvent: jest.Mock };

  const mockActorOwner = {
    sub: 'user-1',
    email: 'owner@mlv.dev',
    role: 'OWNER' as UserRole,
    actorType: ActorType.USER,
  };

  const mockActorTimPenjahit = {
    sub: 'penjahit-1',
    email: 'penjahit@mlv.dev',
    role: 'TIM_PENJAHIT' as UserRole,
    actorType: ActorType.USER,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockOrderService = {
      addTimelineEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionService,
        {
          provide: EventBusService,
          useValue: {
            publish: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: OrderService,
          useValue: mockOrderService,
        },
      ],
    }).compile();

    service = module.get<ProductionService>(ProductionService);
  });

  // ==========================================
  // Test 1: Skip logic Printing/Embroidery
  // ==========================================
  describe('handleOrderConfirmed - skip logic', () => {
    it('should skip PRINTING task when no sablon service', async () => {
      const orderItem = {
        id: 'item-1',
        productType: 'KAOS',
        services: [],
      };

      const routing = {
        id: 'routing-1',
        productType: 'KAOS',
        urutanTask: ['CUTTING', 'PRINTING', 'SEWING', 'FINISHING', 'IRONING', 'PACKING'],
      };

      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([orderItem]);
      (prisma.productionRouting.findUnique as jest.Mock).mockResolvedValue(routing);
      (prisma.productionTask.create as jest.Mock).mockResolvedValue({ id: 'task-1' });
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));

      await service.handleOrderConfirmed('order-1', 'MLV-20260714-0001', 'customer-1');

      const createdTasks = (prisma.productionTask.create as jest.Mock).mock.calls;
      const taskTypesCreated = createdTasks.map((call: any[]) => call[0]?.data?.taskType);

      expect(taskTypesCreated).toContain('CUTTING');
      expect(taskTypesCreated).toContain('SEWING');
      expect(taskTypesCreated).not.toContain('PRINTING');
    });

    it('should skip EMBROIDERY task when no bordir service', async () => {
      const orderItem = {
        id: 'item-2',
        productType: 'KAOS',
        services: [{ serviceType: 'Sablon DTG' }],
      };

      const routing = {
        id: 'routing-1',
        productType: 'KAOS',
        urutanTask: [
          'CUTTING',
          'PRINTING',
          'EMBROIDERY',
          'SEWING',
          'FINISHING',
          'IRONING',
          'PACKING',
        ],
      };

      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([orderItem]);
      (prisma.productionRouting.findUnique as jest.Mock).mockResolvedValue(routing);
      (prisma.productionTask.create as jest.Mock).mockResolvedValue({ id: 'task-1' });
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));

      await service.handleOrderConfirmed('order-1', 'MLV-20260714-0001', 'customer-1');

      const createdTasks = (prisma.productionTask.create as jest.Mock).mock.calls;
      const taskTypesCreated = createdTasks.map((call: any[]) => call[0]?.data?.taskType);

      expect(taskTypesCreated).toContain('PRINTING');
      expect(taskTypesCreated).not.toContain('EMBROIDERY');
    });

    it('should include PRINTING when sablon service exists', async () => {
      const orderItem = {
        id: 'item-3',
        productType: 'KAOS',
        services: [{ serviceType: 'Sablon DTG' }],
      };

      const routing = {
        id: 'routing-1',
        productType: 'KAOS',
        urutanTask: ['CUTTING', 'PRINTING', 'SEWING', 'FINISHING', 'IRONING', 'PACKING'],
      };

      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue([orderItem]);
      (prisma.productionRouting.findUnique as jest.Mock).mockResolvedValue(routing);
      (prisma.productionTask.create as jest.Mock).mockResolvedValue({ id: 'task-1' });
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));

      await service.handleOrderConfirmed('order-1', 'MLV-20260714-0001', 'customer-1');

      const createdTasks = (prisma.productionTask.create as jest.Mock).mock.calls;
      const taskTypesCreated = createdTasks.map((call: any[]) => call[0]?.data?.taskType);

      expect(taskTypesCreated).toContain('PRINTING');
    });
  });

  // ==========================================
  // Test 2: RBAC Tim Penjahit
  // ==========================================
  describe('updateTaskStatus - RBAC', () => {
    it('should allow Tim Penjahit to update their assigned task', async () => {
      const task = {
        id: 'task-1',
        orderItemId: 'item-1',
        taskType: 'SEWING',
        sequence: 3,
        status: 'SEDANG_DILAKSANAKAN',
        assignedTo: 'penjahit-1',
        orderItem: {
          orderId: 'order-1',
          order: { orderNumber: 'MLV-001' },
        },
      };

      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue(task);
      (prisma.productionTask.update as jest.Mock).mockResolvedValue({
        ...task,
        status: 'SELESAI',
        completedAt: new Date(),
      });
      (prisma.productionTask.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.productionTask.count as jest.Mock).mockResolvedValue(0);

      await service.updateTaskStatus('task-1', { status: 'SELESAI' }, mockActorTimPenjahit);

      expect(prisma.productionTask.update).toHaveBeenCalled();
    });

    it('should reject Tim Penjahit updating task assigned to another worker', async () => {
      const task = {
        id: 'task-1',
        orderItemId: 'item-1',
        taskType: 'SEWING',
        sequence: 3,
        status: 'SEDANG_DILAKSANAKAN',
        assignedTo: 'penjahit-2',
        orderItem: {
          orderId: 'order-1',
          order: { orderNumber: 'MLV-001' },
        },
      };

      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue(task);

      await expect(
        service.updateTaskStatus('task-1', { status: 'SELESAI' }, mockActorTimPenjahit),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.productionTask.update).not.toHaveBeenCalled();
    });

    it('should allow Owner/Manajer to update any task regardless of assignment', async () => {
      const task = {
        id: 'task-1',
        orderItemId: 'item-1',
        taskType: 'SEWING',
        sequence: 3,
        status: 'SEDANG_DILAKSANAKAN',
        assignedTo: 'penjahit-1',
        orderItem: {
          orderId: 'order-1',
          order: { orderNumber: 'MLV-001' },
        },
      };

      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue(task);
      (prisma.productionTask.update as jest.Mock).mockResolvedValue({
        ...task,
        status: 'SELESAI',
        completedAt: new Date(),
      });
      (prisma.productionTask.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.productionTask.count as jest.Mock).mockResolvedValue(0);

      await service.updateTaskStatus('task-1', { status: 'SELESAI' }, mockActorOwner);

      expect(prisma.productionTask.update).toHaveBeenCalled();
    });
  });

  // ==========================================
  // Test 3: Chain TaskCompleted → Next Task
  // ==========================================
  describe('updateTaskStatus - task chain', () => {
    it('should trigger next task when current task is completed', async () => {
      const currentTask = {
        id: 'task-1',
        orderItemId: 'item-1',
        taskType: 'CUTTING',
        sequence: 1,
        status: 'SEDANG_DILAKSANAKAN',
        assignedTo: 'penjahit-1',
        orderItem: {
          orderId: 'order-1',
          order: { orderNumber: 'MLV-001' },
        },
      };

      const nextTask = {
        id: 'task-2',
        orderItemId: 'item-1',
        taskType: 'PRINTING',
        sequence: 2,
        status: 'MENUNGGU',
      };

      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue(currentTask);
      (prisma.productionTask.update as jest.Mock).mockResolvedValue({
        ...currentTask,
        status: 'SELESAI',
        completedAt: new Date(),
      });
      (prisma.productionTask.findFirst as jest.Mock).mockResolvedValue(nextTask);
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([nextTask]);
      (prisma.productionTask.count as jest.Mock).mockResolvedValue(1);

      await service.updateTaskStatus('task-1', { status: 'SELESAI' }, mockActorOwner);

      // Verifikasi: Task berikutnya di-update ke DITERIMA
      expect(prisma.productionTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-2' },
          data: { status: 'DITERIMA' },
        }),
      );

      // Verifikasi: Timeline dicatat via OrderService
      expect(mockOrderService.addTimelineEvent).toHaveBeenCalledWith(
        'order-1',
        'PRODUCTION_TASK_COMPLETED',
        expect.stringContaining('CUTTING'),
        'user-1',
      );
    });

    it('should record timeline event when all tasks are completed', async () => {
      const lastTask = {
        id: 'task-6',
        orderItemId: 'item-1',
        taskType: 'PACKING',
        sequence: 6,
        status: 'SEDANG_DILAKSANAKAN',
        assignedTo: 'penjahit-1',
        orderItem: {
          orderId: 'order-1',
          order: { orderNumber: 'MLV-001' },
        },
      };

      const order = {
        id: 'order-1',
        orderNumber: 'MLV-001',
        customerId: 'customer-1',
        items: [{ id: 'item-1' }],
      };

      (prisma.productionTask.findUnique as jest.Mock).mockResolvedValue(lastTask);
      (prisma.productionTask.update as jest.Mock).mockResolvedValue({
        ...lastTask,
        status: 'SELESAI',
        completedAt: new Date(),
      });
      (prisma.productionTask.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.productionTask.findMany as jest.Mock).mockResolvedValue([lastTask]);
      (prisma.productionTask.count as jest.Mock).mockResolvedValue(0);
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(order);
      (prisma.orderItem.findMany as jest.Mock).mockResolvedValue(order.items);

      await service.updateTaskStatus('task-6', { status: 'SELESAI' }, mockActorOwner);

      // Verifikasi: ProductionCompleted event dipublish (check second call)
      const calls = mockOrderService.addTimelineEvent.mock.calls;
      expect(calls[1]).toEqual([
        'order-1',
        'PRODUCTION_COMPLETED',
        expect.stringContaining('MLV-001'),
      ]);
    });
  });
});
