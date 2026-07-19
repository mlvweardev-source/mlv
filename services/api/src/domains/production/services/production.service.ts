import {
  Injectable,
  Inject,
  forwardRef,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { prisma } from '@mlv/db';
import type { TaskStatus, TaskType } from '@mlv/db';
import type { JwtPayload } from '@mlv/auth';
import { ActorType } from '@mlv/auth';
import { EVENT_NAMES } from '@mlv/types';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import {
  GetTasksQueryDto,
  UpdateTaskStatusDto,
  AssignTaskDto,
  ProductionTaskResponseDto,
  ProductionRoutingResponseDto,
} from '../dto/production.dto';
import {
  TaskStartedEvent,
  TaskCompletedEvent,
  ProductionCompletedEvent,
} from '../events/production.events';
import { OrderService } from '../../order/services/order.service';
import { CustomerService } from '../../customer/services/customer.service';

/**
 * Production Domain Service
 *
 * Responsibility: Task produksi granular, penugasan, timeline.
 * Komunikasi dengan domain lain: selalu lewat service method, bukan query Prisma langsung.
 *
 * §7.1: Memublikasikan TaskStarted, TaskCompleted, ProductionCompleted.
 * §7.1: Mengonsumsi OrderConfirmed untuk generate task dari routing.
 * §4.1: DDD boundary - tidak boleh akses tabel domain lain langsung.
 */
@Injectable()
export class ProductionService {
  private readonly logger = new Logger(ProductionService.name);

  constructor(
    private readonly eventBus: EventBusService,
    // forwardRef (Fase 9): circular dependency Order ↔ Production —
    // Order butuh getOrderIdsForAssignee, Production butuh addTimelineEvent.
    @Inject(forwardRef(() => OrderService))
    private readonly orderService: OrderService,
    private readonly customerService: CustomerService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ==========================================
  // Task Generation dari OrderConfirmed
  // ==========================================

  /**
   * Handle OrderConfirmed event — generate production tasks.
   *
   * Untuk setiap order_item, ambil routing sesuai product_type.
   * Skip task PRINTING/EMBROIDERY jika order_item tidak punya service terkait.
   */
  async handleOrderConfirmed(
    orderId: string,
    orderNumber: string,
    customerId: string,
  ): Promise<void> {
    this.logger.log(`Handling OrderConfirmed for order ${orderNumber}`);

    // Ambil semua order items
    const orderItems = await prisma.orderItem.findMany({
      where: { orderId },
      include: {
        services: true, // Untuk cek apakah ada sablon/bordir
      },
    });

    if (orderItems.length === 0) {
      this.logger.warn(`No items found for order ${orderNumber}`);
      return;
    }

    // Generate tasks untuk setiap item
    for (const item of orderItems) {
      await this.generateTasksForOrderItem(item, orderId, orderNumber);
    }

    this.logger.log(`Generated tasks for ${orderItems.length} items in order ${orderNumber}`);
  }

  /**
   * Generate tasks untuk satu order item berdasarkan routing.
   * Task pertama status=DITERIMA, sisanya status=MENUNGGU.
   */
  private async generateTasksForOrderItem(
    item: any,
    orderId: string,
    orderNumber: string,
  ): Promise<void> {
    // IDEMPOTENCY (§16): skip jika order item sudah punya production tasks —
    // event OrderConfirmed yang dikirim dua kali tidak boleh menghasilkan
    // task ganda. Cek state DB, bukan mengandalkan dedup BullMQ.
    const existingTaskCount = await prisma.productionTask.count({
      where: { orderItemId: item.id },
    });

    if (existingTaskCount > 0) {
      this.logger.log(
        `Order item ${item.id} sudah punya ${existingTaskCount} tasks — skip (idempotent no-op)`,
      );
      return;
    }

    // Ambil routing untuk product type ini
    const routing = await prisma.productionRouting.findUnique({
      where: { productType: item.productType },
    });

    if (!routing) {
      this.logger.warn(
        `No routing found for product type "${item.productType}" — skipping task generation`,
      );
      return;
    }

    // Cek apakah ada service sablon/bordir
    const hasSablonService = item.services.some((s: any) =>
      s.serviceType.toLowerCase().includes('sablon'),
    );
    const hasBordirService = item.services.some((s: any) =>
      s.serviceType.toLowerCase().includes('bordir'),
    );

    // Filter task sesuai services
    const taskTypesToCreate = routing.urutanTask.filter((taskType) => {
      if (taskType === 'PRINTING' && !hasSablonService) return false;
      if (taskType === 'EMBROIDERY' && !hasBordirService) return false;
      return true;
    });

    if (taskTypesToCreate.length === 0) {
      this.logger.warn(`No tasks to create for order item ${item.id} after filtering`);
      return;
    }

    // Buat tasks dalam transaksi
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < taskTypesToCreate.length; i++) {
        const taskType = taskTypesToCreate[i] as TaskType;
        const sequence = i + 1;
        const status: TaskStatus = i === 0 ? 'DITERIMA' : 'MENUNGGU';

        await tx.productionTask.create({
          data: {
            orderItemId: item.id,
            taskType,
            sequence,
            status,
          },
        });

        this.logger.debug(
          `Created task: ${taskType} (seq=${sequence}, status=${status}) for order item ${item.id}`,
        );
      }
    });

    this.logger.log(
      `Created ${taskTypesToCreate.length} tasks for order item ${item.id} (${item.productType})`,
    );
  }

  // ==========================================
  // Query Methods
  // ==========================================

  /**
   * GET /production/routings/:productType
   */
  async getRoutingByProductType(productType: string): Promise<ProductionRoutingResponseDto> {
    const routing = await prisma.productionRouting.findUnique({
      where: { productType },
    });

    if (!routing) {
      throw new NotFoundException(`Routing untuk "${productType}" tidak ditemukan`);
    }

    return {
      id: routing.id,
      productType: routing.productType,
      urutanTask: routing.urutanTask,
      createdAt: routing.createdAt,
      updatedAt: routing.updatedAt,
    };
  }

  /**
   * GET /production/tasks
   */
  async getDesignRevisionEligibility(orderItemIds: string[]): Promise<
    Record<
      string,
      {
        allowed: boolean;
        cuttingStatus: TaskStatus | null;
        reason: string | null;
      }
    >
  > {
    if (orderItemIds.length === 0) return {};

    const cuttingTasks = await prisma.productionTask.findMany({
      where: {
        orderItemId: { in: orderItemIds },
        taskType: 'CUTTING',
      },
      select: { orderItemId: true, status: true },
    });
    const taskByItem = new Map(cuttingTasks.map((task) => [task.orderItemId, task.status]));

    return Object.fromEntries(
      orderItemIds.map((orderItemId) => {
        const cuttingStatus = taskByItem.get(orderItemId) ?? null;
        const allowed =
          cuttingStatus === null || cuttingStatus === 'MENUNGGU' || cuttingStatus === 'DITERIMA';
        return [
          orderItemId,
          {
            allowed,
            cuttingStatus,
            reason: allowed
              ? null
              : `Revisi desain tidak dapat diunggah karena proses Cutting sudah dimulai (status: ${cuttingStatus}).`,
          },
        ];
      }),
    );
  }

  async assertDesignRevisionAllowed(orderItemId: string): Promise<void> {
    const eligibility = (await this.getDesignRevisionEligibility([orderItemId]))[orderItemId];
    if (!eligibility.allowed) {
      throw new BadRequestException(eligibility.reason);
    }
  }

  async getTasks(query: GetTasksQueryDto): Promise<ProductionTaskResponseDto[]> {
    const where: any = {};
    if (query.orderId) {
      where.orderItem = { orderId: query.orderId };
    }
    if (query.orderItemId) {
      where.orderItemId = query.orderItemId;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.assignedTo) {
      where.assignedTo = query.assignedTo;
    }

    const tasks = await prisma.productionTask.findMany({
      where,
      include: {
        orderItem: {
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                customerId: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: [{ orderItem: { order: { createdAt: 'asc' } } }, { sequence: 'asc' }],
    });

    // Ambil user info untuk assignedTo
    const userIds = [...new Set(tasks.map((t) => t.assignedTo).filter(Boolean))];
    const users =
      userIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIds as string[] } },
          })
        : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return tasks.map((task) => ({
      id: task.id,
      orderItemId: task.orderItemId,
      taskType: task.taskType,
      sequence: task.sequence,
      status: task.status,
      assignedTo: task.assignedTo,
      assignedToUser: task.assignedTo
        ? {
            id: task.assignedTo,
            nama: userMap.get(task.assignedTo)?.nama ?? '',
            email: userMap.get(task.assignedTo)?.email ?? '',
          }
        : null,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      orderItem: {
        id: task.orderItem.id,
        productType: task.orderItem.productType,
        orderId: task.orderItem.orderId,
        order: task.orderItem.order,
      },
    }));
  }

  /**
   * GET /production/tasks/:id
   */
  async getTaskById(taskId: string): Promise<ProductionTaskResponseDto> {
    const task = await prisma.productionTask.findUnique({
      where: { id: taskId },
      include: {
        orderItem: {
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                customerId: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Task tidak ditemukan');
    }

    let assignedToUser = null;
    if (task.assignedTo) {
      const user = await prisma.user.findUnique({
        where: { id: task.assignedTo },
      });
      if (user) {
        assignedToUser = {
          id: user.id,
          nama: user.nama,
          email: user.email,
        };
      }
    }

    return {
      id: task.id,
      orderItemId: task.orderItemId,
      taskType: task.taskType,
      sequence: task.sequence,
      status: task.status,
      assignedTo: task.assignedTo,
      assignedToUser,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      orderItem: {
        id: task.orderItem.id,
        productType: task.orderItem.productType,
        orderId: task.orderItem.orderId,
        order: task.orderItem.order,
      },
    };
  }

  // ==========================================
  // Cross-Domain: Order IDs per Assignee (DDD Boundary §4.1)
  // ==========================================
  // Order Domain memanggil method ini untuk filter "order miliknya"
  // bagi Tim Penjahit (§5.1) — Order TIDAK BOLEH query production_tasks langsung.

  /**
   * Ambil daftar order ID yang punya task ditugaskan ke user tertentu.
   * Dipakai Order Domain untuk view terbatas Tim Penjahit.
   */
  async getOrderIdsForAssignee(userId: string): Promise<string[]> {
    const tasks = await prisma.productionTask.findMany({
      where: { assignedTo: userId },
      select: { orderItem: { select: { orderId: true } } },
    });
    return [...new Set(tasks.map((t) => t.orderItem.orderId))];
  }

  // ==========================================
  // Task Assignment
  // ==========================================

  /**
   * POST /production/tasks/:id/assign
   * Owner & Manajer Produksi bisa assign task ke Tim Penjahit manapun.
   */
  async assignTask(
    taskId: string,
    dto: AssignTaskDto,
    actor: JwtPayload,
  ): Promise<ProductionTaskResponseDto> {
    // RBAC: hanya Owner & Manajer Produksi
    if (actor.role !== 'OWNER' && actor.role !== 'MANAJER_PRODUKSI') {
      throw new ForbiddenException('Hanya Owner dan Manajer Produksi yang bisa menugaskan task');
    }

    // Verifikasi user target ada dan rolenya TIM_PENJAHIT
    const targetUser = await prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!targetUser) {
      throw new NotFoundException('User tidak ditemukan');
    }

    if (targetUser.role !== 'TIM_PENJAHIT') {
      throw new BadRequestException('Task hanya bisa ditugaskan ke Tim Penjahit');
    }

    // Update task
    const task = await prisma.productionTask.update({
      where: { id: taskId },
      data: {
        assignedTo: dto.userId,
        status: 'SEDANG_DILAKSANAKAN',
        startedAt: new Date(),
      },
    });

    // Publish TaskStarted event
    const fullTask = await this.getTaskById(taskId);
    if (fullTask.orderItem) {
      await this.eventBus.publish(
        EVENT_NAMES.TaskStarted,
        new TaskStartedEvent(
          task.id,
          task.orderItemId,
          task.taskType,
          fullTask.orderItem.orderId,
          fullTask.orderItem.order?.orderNumber ?? '',
          task.startedAt!,
        ),
      );

      // Activity Log (§6.8): penugasan task = aksi penting
      await this.activityLog.log(
        actor.sub,
        actor.role ?? null,
        `Task "${task.taskType}" (urutan ${task.sequence}) untuk order ${fullTask.orderItem.order?.orderNumber} ditugaskan ke ${targetUser.nama}`,
        'ProductionTask',
        task.id,
      );
    }

    return fullTask;
  }

  // ==========================================
  // Task Status Update
  // ==========================================

  /**
   * PATCH /production/tasks/:id/status
   * - Owner & Manajer Produksi: bisa update task apapun
   * - Tim Penjahit: hanya bisa update task yang assignedTo dirinya sendiri
   */
  async updateTaskStatus(
    taskId: string,
    dto: UpdateTaskStatusDto,
    actor: JwtPayload,
  ): Promise<ProductionTaskResponseDto> {
    const task = await prisma.productionTask.findUnique({
      where: { id: taskId },
      include: {
        orderItem: {
          include: {
            order: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Task tidak ditemukan');
    }

    // RBAC untuk Tim Penjahit
    if (actor.role === 'TIM_PENJAHIT') {
      if (task.assignedTo !== actor.sub) {
        throw new ForbiddenException('Anda hanya bisa mengupdate task yang ditugaskan kepada Anda');
      }
    }

    // Validasi transisi status
    this.validateStatusTransition(task.status, dto.status);

    // Update task
    const updatedTask = await prisma.productionTask.update({
      where: { id: taskId },
      data: {
        status: dto.status,
        ...(dto.status === 'SELESAI' ? { completedAt: new Date() } : {}),
      },
    });

    // Publish events
    if (dto.status === 'SELESAI') {
      // Catat ke timeline via OrderService (DDD boundary)
      await this.addOrderTimelineEvent(
        task.orderItem.orderId,
        'PRODUCTION_TASK_COMPLETED',
        `Task ${task.taskType} (urutan ${task.sequence}) untuk item pesanan telah selesai`,
        actor.sub,
      );

      // Publish TaskCompleted event
      await this.eventBus.publish(
        EVENT_NAMES.TaskCompleted,
        new TaskCompletedEvent(
          task.id,
          task.orderItemId,
          task.taskType,
          task.sequence,
          task.orderItem.orderId,
          task.orderItem.order.orderNumber,
          updatedTask.completedAt!,
        ),
      );

      // Activity Log (§6.8): task selesai = aksi penting
      await this.activityLog.log(
        actor.sub,
        actor.role ?? null,
        `Task "${task.taskType}" (urutan ${task.sequence}) untuk order ${task.orderItem.order.orderNumber} ditandai SELESAI`,
        'ProductionTask',
        task.id,
      );

      // Trigger task berikutnya jika ada
      await this.triggerNextTask(task.orderItemId, task.sequence, task.orderItem.orderId);
    }

    return this.getTaskById(taskId);
  }

  /**
   * Validasi transisi status.
   */
  private validateStatusTransition(currentStatus: TaskStatus, newStatus: TaskStatus): void {
    // DITERIMA -> SEDANG_DILAKSANAKAN
    // MENUNGGU -> SEDANG_DILAKSANAKAN
    // SEDANG_DILAKSANAKAN -> SELESAI
    // SELESAI tidak bisa di-ubah lagi (terminal state)

    if (currentStatus === 'SELESAI') {
      throw new BadRequestException('Task yang sudah selesai tidak bisa diubah');
    }

    const validTransitions: Record<TaskStatus, TaskStatus[]> = {
      DITERIMA: ['SEDANG_DILAKSANAKAN', 'SELESAI'],
      MENUNGGU: ['SEDANG_DILAKSANAKAN'],
      SEDANG_DILAKSANAKAN: ['SELESAI'],
      SELESAI: [], // terminal state
    };

    if (!validTransitions[currentStatus].includes(newStatus)) {
      throw new BadRequestException(
        `Tidak bisa mengubah status dari ${currentStatus} ke ${newStatus}`,
      );
    }
  }

  /**
   * Trigger task berikutnya dalam urutan routing.
   * Dipanggil saat TaskCompleted.
   *
   * PRINSIP DDD: catat timeline ke Order Domain lewat service, bukan langsung ke DB.
   */
  private async triggerNextTask(
    orderItemId: string,
    completedSequence: number,
    orderId: string,
  ): Promise<void> {
    // Cari task berikutnya
    const nextTask = await prisma.productionTask.findFirst({
      where: {
        orderItemId,
        sequence: completedSequence + 1,
      },
      include: {
        orderItem: {
          include: {
            order: true,
          },
        },
      },
    });

    if (!nextTask) {
      // Tidak ada task berikutnya — cek apakah semua task sudah selesai
      await this.checkProductionCompletion(orderItemId, orderId);
      return;
    }

    // Update status task berikutnya ke DITERIMA
    await prisma.productionTask.update({
      where: { id: nextTask.id },
      data: { status: 'DITERIMA' },
    });

    // Catat ke timeline via OrderService (DDD boundary)
    await this.addOrderTimelineEvent(
      orderId,
      'PRODUCTION_TASK_STARTED',
      `Task ${nextTask.taskType} (urutan ${nextTask.sequence}) untuk item pesanan sekarang dapat dikerjakan`,
    );

    this.logger.log(
      `Triggered next task: ${nextTask.taskType} (seq=${nextTask.sequence}) for order item ${orderItemId}`,
    );

    // Cek lagi apakah ini task terakhir
    const allTasks = await prisma.productionTask.findMany({
      where: { orderItemId },
      orderBy: { sequence: 'desc' },
      take: 1,
    });

    if (allTasks[0]?.id === nextTask.id) {
      await this.checkProductionCompletion(orderItemId, orderId);
    }
  }

  /**
   * Cek apakah semua task untuk satu order item sudah selesai.
   * Jika ya, publish ProductionCompleted.
   */
  private async checkProductionCompletion(orderItemId: string, orderId: string): Promise<void> {
    const pendingTasks = await prisma.productionTask.count({
      where: {
        orderItemId,
        status: { not: 'SELESAI' },
      },
    });

    if (pendingTasks === 0) {
      // Semua task selesai untuk order item ini
      // Cek apakah semua order items sudah selesai
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) return;

      let allItemsComplete = true;
      for (const item of order.items) {
        const itemPending = await prisma.productionTask.count({
          where: {
            orderItemId: item.id,
            status: { not: 'SELESAI' },
          },
        });
        if (itemPending > 0) {
          allItemsComplete = false;
          break;
        }
      }

      if (allItemsComplete) {
        // Catat ke timeline via OrderService (DDD boundary)
        await this.addOrderTimelineEvent(
          orderId,
          'PRODUCTION_COMPLETED',
          `Semua task produksi untuk order ${order.orderNumber} telah selesai`,
        );

        // Publish ProductionCompleted — payload lengkap dengan kontak
        // pelanggan (Fase 8): via CustomerService, bukan query customer
        // langsung; Notification proses terpisah tidak memanggil balik.
        const customer = await this.customerService.getCustomerByIdInternal(order.customerId);
        await this.eventBus.publish(
          EVENT_NAMES.ProductionCompleted,
          new ProductionCompletedEvent(
            orderId,
            order.orderNumber,
            order.customerId,
            new Date(),
            customer?.nama ?? 'Pelanggan',
            customer?.noHp ?? null,
          ),
        );

        this.logger.log(`Production completed for order ${order.orderNumber}`);
      }
    }
  }

  // ==========================================
  // Cross-Domain: Add Timeline Event via OrderService
  // ==========================================
  // Production Domain TIDAK BOLEH akses prisma.orderTimelineEvent.create() langsung.
  // Semua pencatatan timeline ke Order Domain harus lewat OrderService.

  /**
   * Catat timeline event ke Order Domain.
   * Delegasi ke OrderService.addTimelineEvent() — DDD boundary §4.1.
   */
  async addOrderTimelineEvent(
    orderId: string,
    eventType: string,
    description: string,
    actorId?: string,
  ): Promise<void> {
    await this.orderService.addTimelineEvent(orderId, eventType, description, actorId);
  }

  // ==========================================
  // AI Production Assistant Context (Fase 12 Bagian 3)
  // ==========================================

  /**
   * Kumpulkan konteks produksi lengkap untuk AI Production Assistant.
   *
   * Data dikumpulkan dari tabel milik Production Domain (production_tasks)
   * + pemanggilan service method OrderService.getOrderByIdInternal() untuk
   * info order. DDD §4.1: tidak query tabel orders langsung.
   *
   * @returns null kalau order tidak ditemukan
   */
  async getProductionContextForAi(orderId: string): Promise<{
    orderNumber: string;
    orderStatus: string;
    tasks: Array<{
      taskType: string;
      sequence: number;
      status: string;
      assignedToNama: string | null;
      productType: string;
      startedAt: string | null;
    }>;
    taskCountByStage: Record<string, { total: number; active: number; waiting: number }>;
  } | null> {
    // Ambil info order via service method (DDD boundary)
    const order = await this.orderService.getOrderByIdInternal(orderId);
    if (!order) return null;

    // Ambil semua task untuk order ini (tabel milik Production Domain sendiri)
    const tasks = await prisma.productionTask.findMany({
      where: {
        orderItem: { orderId },
      },
      include: {
        orderItem: {
          select: { productType: true },
        },
      },
      orderBy: [{ orderItem: { order: { createdAt: 'asc' } } }, { sequence: 'asc' }],
    });

    // Ambil nama assignee
    const userIds = [...new Set(tasks.map((t) => t.assignedTo).filter(Boolean))];
    const users =
      userIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIds as string[] } },
            select: { id: true, nama: true },
          })
        : [];
    const userMap = new Map(users.map((u) => [u.id, u.nama]));

    // Hitung jumlah task per tahap
    const taskCountByStage: Record<string, { total: number; active: number; waiting: number }> = {};
    for (const task of tasks) {
      if (!taskCountByStage[task.taskType]) {
        taskCountByStage[task.taskType] = { total: 0, active: 0, waiting: 0 };
      }
      taskCountByStage[task.taskType].total++;
      if (task.status === 'SEDANG_DILAKSANAKAN' || task.status === 'DITERIMA') {
        taskCountByStage[task.taskType].active++;
      }
      if (task.status === 'MENUNGGU') {
        taskCountByStage[task.taskType].waiting++;
      }
    }

    return {
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      tasks: tasks.map((t) => ({
        taskType: t.taskType,
        sequence: t.sequence,
        status: t.status,
        assignedToNama: t.assignedTo ? (userMap.get(t.assignedTo as string) ?? null) : null,
        productType: t.orderItem.productType,
        startedAt: t.startedAt?.toISOString() ?? null,
      })),
      taskCountByStage,
    };
  }

  // ==========================================
  // Analytics Internal Methods (Fase 13)
  // ==========================================

  /**
   * Rata-rata lead time produksi: dari task pertama (startedAt) ke task terakhir (completedAt)
   * per order, dirata-ratakan di semua order dalam periode.
   * Dipanggil oleh AnalyticsService (DDD boundary).
   */
  async getAverageLeadTime(from: Date, to: Date): Promise<number | null> {
    // Ambil order yang punya task dalam periode
    const tasks = await prisma.productionTask.findMany({
      where: {
        completedAt: { gte: from, lte: to },
        status: 'SELESAI',
      },
      select: {
        orderItemId: true,
        sequence: true,
        startedAt: true,
        completedAt: true,
        orderItem: { select: { orderId: true } },
      },
      orderBy: { sequence: 'asc' },
    });

    // Group by orderId
    const orderTasks = new Map<
      string,
      Array<{ sequence: number; startedAt: Date | null; completedAt: Date | null }>
    >();
    for (const t of tasks) {
      const orderId = t.orderItem.orderId;
      const list = orderTasks.get(orderId) ?? [];
      list.push({ sequence: t.sequence, startedAt: t.startedAt, completedAt: t.completedAt });
      orderTasks.set(orderId, list);
    }

    // Hitung lead time per order: earliest startedAt → latest completedAt
    const leadTimes: number[] = [];
    for (const [, orderTaskList] of orderTasks.entries()) {
      const sorted = orderTaskList.sort((a, b) => a.sequence - b.sequence);
      const firstTask = sorted[0];
      const lastTask = sorted[sorted.length - 1];

      if (firstTask?.startedAt && lastTask?.completedAt) {
        const leadTimeMs = lastTask.completedAt.getTime() - firstTask.startedAt.getTime();
        if (leadTimeMs > 0) {
          leadTimes.push(leadTimeMs);
        }
      }
    }

    if (leadTimes.length === 0) return null;

    // Return average in hours
    const avgMs = leadTimes.reduce((sum, lt) => sum + lt, 0) / leadTimes.length;
    return Math.round((avgMs / (1000 * 60 * 60)) * 10) / 10; // hours, 1 decimal
  }

  /**
   * Reject rate QC: % task yang qc_status='reject' dari total task yang sudah QC.
   * Dipanggil oleh AnalyticsService (DDD boundary).
   */
  async getRejectRate(
    from: Date,
    to: Date,
  ): Promise<{ total: number; rejected: number; rate: number }> {
    const tasksWithQc = await prisma.productionTask.findMany({
      where: {
        qcStatus: { not: null },
        qcAt: { gte: from, lte: to },
      },
      select: { qcStatus: true },
    });

    const total = tasksWithQc.length;
    const rejected = tasksWithQc.filter((t) => t.qcStatus === 'reject').length;
    const rate = total > 0 ? rejected / total : 0;

    return { total, rejected, rate };
  }

  /**
   * Estimasi biaya jahit per produk dari production_routings.
   * PLACEHOLDER — field estimasiBiayaJahitPerPcs adalah estimasi, bukan data final.
   * Dipanggil oleh AnalyticsService untuk kalkulasi Profit.
   */
  async getProductionCostPerProduct(): Promise<Record<string, number>> {
    const routings = await prisma.productionRouting.findMany({
      select: { productType: true, estimasiBiayaJahitPerPcs: true },
    });

    const result: Record<string, number> = {};
    for (const r of routings) {
      result[r.productType] = r.estimasiBiayaJahitPerPcs ?? 0;
    }
    return result;
  }

  /**
   * Set QC status untuk task (PATCH /production/tasks/:id/qc).
   * Hanya Manajer Produksi/Owner yang bisa. Task harus SELESAI dulu.
   */
  async setQcStatus(
    taskId: string,
    dto: { qcStatus: 'pass' | 'reject'; qcReason?: string },
    actor: JwtPayload,
  ): Promise<any> {
    if (actor.role !== 'OWNER' && actor.role !== 'MANAJER_PRODUKSI') {
      throw new ForbiddenException('Hanya Owner atau Manajer Produksi yang bisa verifikasi QC');
    }

    const task = await prisma.productionTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundException('Task tidak ditemukan');
    }

    if (task.status !== 'SELESAI') {
      throw new BadRequestException('QC hanya bisa dilakukan setelah task SELESAI');
    }

    return prisma.productionTask.update({
      where: { id: taskId },
      data: {
        qcStatus: dto.qcStatus,
        qcReason: dto.qcStatus === 'reject' ? (dto.qcReason ?? null) : null,
        qcBy: actor.sub,
        qcAt: new Date(),
      },
    });
  }
}
