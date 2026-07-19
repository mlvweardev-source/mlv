import {
  Injectable,
  Inject,
  forwardRef,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@mlv/db';
import type { Prisma } from '@mlv/db';
import { ActorType, UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { EVENT_NAMES } from '@mlv/types';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { ProductionService } from '../../production/services/production.service';
import { ReserveStockDto } from '../../inventory/dto/inventory.dto';
import {
  CreateOrderDto,
  AddOrderItemDto,
  UpdateDraftOrderItemDto,
  UpdateOrderStatusDto,
  AddOrderServiceDto,
  AddOrderItemResponseDto,
  FindOrdersQueryDto,
  OrderResponseDto,
  OrderListResponseDto,
  OrderItemResponseDto,
} from '../dto/order.dto';
import {
  OrderCreatedEvent,
  OrderConfirmedEvent,
  OrderCancelledEvent,
  OrderStatusChangedEvent,
} from '../events/order.events';

// File interface compatible with multer
interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  destination: string;
  filename: string;
  path: string;
  buffer: Buffer;
}

/**
 * Order Domain Service
 *
 * Responsibility: Siklus hidup pesanan - item, ukuran, desain, kebutuhan bahan, layanan tambahan.
 * Komunikasi dengan Inventory Domain: Selalu lewat InventoryService (DDD boundary §4.1).
 */
@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly eventBus: EventBusService,
    private readonly activityLog: ActivityLogService,
    private readonly inventoryService: InventoryService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => ProductionService))
    private readonly productionService: ProductionService,
  ) {}

  // ==========================================
  // Order CRUD
  // ==========================================

  /**
   * POST /orders — Buat order baru (status: DRAFT).
   */
  async createOrder(dto: CreateOrderDto, actor: JwtPayload): Promise<OrderResponseDto> {
    // Verifikasi customer ada
    const customer = await prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) {
      throw new NotFoundException('Pelanggan tidak ditemukan');
    }

    // Cek akses: staff bisa buat order untuk customer manapun,
    // customer hanya bisa buat order untuk dirinya sendiri
    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== dto.customerId) {
      throw new ForbiddenException('Anda tidak bisa membuat order untuk pelanggan lain');
    }

    // Generate order number: MLV-YYYYMMDD-XXXX
    const orderNumber = await this.generateOrderNumber();

    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerId: dto.customerId,
        status: 'DRAFT',
        deadline: dto.deadline ? new Date(dto.deadline) : null,
      },
    });

    // Buat timeline event: order dibuat
    await prisma.orderTimelineEvent.create({
      data: {
        orderId: order.id,
        tipeEvent: 'DIBUAT',
        deskripsi: `Order ${orderNumber} dibuat`,
        actorId: actor.sub,
      },
    });

    // Publish event
    await this.eventBus.publish(
      EVENT_NAMES.OrderCreated,
      new OrderCreatedEvent(order.id, order.orderNumber, order.customerId, order.createdAt),
    );

    return this.getOrderById(order.id, actor);
  }

  /**
   * GET /orders — Daftar order dengan filter status & pencarian order number.
   * Staff (Owner/Manajer): lihat semua. Pelanggan: lihat miliknya sendiri.
   * Tim Penjahit (§5.1 view terbatas): hanya order yang punya task
   * ditugaskan kepadanya — daftar order ID diambil dari Production Domain
   * via ProductionService (DDD boundary §4.1).
   */
  async findOrders(actor: JwtPayload, query?: FindOrdersQueryDto): Promise<OrderListResponseDto[]> {
    const whereClause: Prisma.OrderWhereInput =
      actor.actorType === ActorType.CUSTOMER ? { customerId: actor.sub } : {};

    if (actor.actorType === ActorType.USER && actor.role === UserRole.TIM_PENJAHIT) {
      const orderIds = await this.productionService.getOrderIdsForAssignee(actor.sub);
      whereClause.id = { in: orderIds };
    }

    if (query?.status) {
      whereClause.status = query.status;
    }
    if (query?.search) {
      whereClause.orderNumber = { contains: query.search, mode: 'insensitive' };
    }

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
        items: {
          select: {
            productType: true,
            sizes: { select: { qty: true } },
          },
        },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerId: o.customerId,
      status: o.status,
      deadline: o.deadline,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      _count: o._count,
      itemSummary: (o.items ?? []).map((item) => ({
        productType: item.productType,
        qty: item.sizes.reduce((sum, size) => sum + size.qty, 0),
      })),
    }));
  }

  /**
   * GET /orders/:id — Detail order.
   * Staff: lihat semua. Pelanggan: lihat miliknya sendiri.
   */
  async getOrderById(id: string, actor: JwtPayload): Promise<OrderResponseDto> {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            sizes: true,
            designs: true,
            materials: true, // Plain FK, join manually below
            services: true,
          },
        },
        timeline: {
          orderBy: { createdAt: 'asc' },
        },
        payments: { orderBy: { createdAt: 'desc' } },
        invoices: { orderBy: { createdAt: 'desc' } },
        shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    // Cek akses
    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }
    await this.assertPenjahitCanViewOrder(order.id, actor);

    // Fetch material names for each order material
    const materialIds = [
      ...new Set(order.items.flatMap((item) => item.materials.map((m) => m.materialId))),
    ];
    const materials = await prisma.material.findMany({
      where: { id: { in: materialIds } },
    });
    const materialMap = new Map(materials.map((m) => [m.id, m]));

    // Attach material data to order
    order.items.forEach((item) => {
      item.materials = item.materials.map((m) => ({
        ...m,
        material: materialMap.get(m.materialId),
      }));
    });

    const revisionEligibility = await this.productionService.getDesignRevisionEligibility(
      order.items.map((item) => item.id),
    );

    return this.mapOrderToResponse(order, revisionEligibility);
  }

  // ==========================================
  // Order Items
  // ==========================================

  /**
   * POST /orders/:id/items — Tambah item ke order.
   * Item belum trigger stock reservation (itu terjadi saat checkout).
   */
  async addOrderItem(
    orderId: string,
    dto: AddOrderItemDto,
    actor: JwtPayload,
  ): Promise<AddOrderItemResponseDto> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (order.status !== 'DRAFT') {
      throw new BadRequestException('Hanya order berstatus DRAFT yang bisa ditambahkan item');
    }

    // Cek akses
    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }

    // Hitung total qty dari semua ukuran
    const totalQty = dto.sizes.reduce((sum, s) => sum + s.qty, 0);

    let basePrice = dto.basePriceSnapshot;
    if (actor.actorType === ActorType.CUSTOMER) {
      const priceRef = await prisma.productPriceList.findUnique({
        where: { productType: dto.productType },
      });
      if (!priceRef) {
        throw new BadRequestException(
          `Harga dasar untuk produk "${dto.productType}" belum dikonfigurasi`,
        );
      }
      basePrice = priceRef.hargaDasarPerPcs;
    }

    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productType: dto.productType,
        basePriceSnapshot: basePrice,
        sizes: {
          create: dto.sizes.map((s) => ({
            ukuran: s.ukuran,
            qty: s.qty,
          })),
        },
      },
      include: { sizes: true },
    });

    // Jika ada catatan teks, buat desain placeholder
    if (dto.catatanTeks) {
      await prisma.orderDesign.create({
        data: {
          orderItemId: item.id,
          catatanTeks: dto.catatanTeks,
          statusKonfirmasi: 'MENUNGGU',
          versiRevisi: 1,
        },
      });
    }

    // Timeline event
    await prisma.orderTimelineEvent.create({
      data: {
        orderId: order.id,
        tipeEvent: 'ITEM_DITAMBAH',
        deskripsi: `Ditambahkan item ${dto.productType} (${totalQty} pcs)`,
        actorId: actor.sub,
      },
    });

    return {
      id: item.id,
      orderId: item.orderId,
      productType: item.productType,
      basePriceSnapshot: item.basePriceSnapshot,
      sizes: item.sizes.map((s) => ({ id: s.id, ukuran: s.ukuran, qty: s.qty })),
      createdAt: item.createdAt,
    };
  }

  /**
   * PATCH /orders/:id/items/:itemId - Edit item pada Draft repeat order.
   */
  async updateDraftOrderItem(
    orderId: string,
    itemId: string,
    dto: UpdateDraftOrderItemDto,
    actor: JwtPayload,
  ): Promise<AddOrderItemResponseDto> {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order tidak ditemukan');
    if (order.status !== 'DRAFT') {
      throw new BadRequestException('Item hanya bisa diedit selama order berstatus DRAFT');
    }
    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }
    if (dto.sizes.length === 0) {
      throw new BadRequestException('Minimal satu ukuran harus memiliki kuantitas');
    }

    const existingItem = await prisma.orderItem.findFirst({ where: { id: itemId, orderId } });
    if (!existingItem) throw new NotFoundException('Item tidak ditemukan dalam order ini');

    const priceRef = await prisma.productPriceList.findUnique({
      where: { productType: dto.productType },
    });
    if (!priceRef) {
      throw new BadRequestException(
        `Harga dasar untuk produk "${dto.productType}" belum dikonfigurasi`,
      );
    }

    const item = await prisma.orderItem.update({
      where: { id: itemId },
      data: {
        productType: dto.productType,
        basePriceSnapshot: priceRef.hargaDasarPerPcs,
        sizes: {
          deleteMany: {},
          create: dto.sizes.map((size) => ({ ukuran: size.ukuran, qty: size.qty })),
        },
      },
      include: { sizes: true },
    });

    await prisma.orderTimelineEvent.create({
      data: {
        orderId,
        tipeEvent: 'ITEM_DIEDIT',
        deskripsi: `Item ${dto.productType} diperbarui sebelum checkout ulang`,
        actorId: actor.sub,
      },
    });

    return {
      id: item.id,
      orderId: item.orderId,
      productType: item.productType,
      basePriceSnapshot: item.basePriceSnapshot,
      sizes: item.sizes.map((size) => ({ id: size.id, ukuran: size.ukuran, qty: size.qty })),
      createdAt: item.createdAt,
    };
  }

  // ==========================================
  // Order Designs (Upload)
  // ==========================================

  /**
   * POST /orders/:id/items/:itemId/designs — Upload desain via file.
   * File disimpan ke local disk (folder: uploads/designs/).
   * Nanti bisa di-swap ke S3-compatible storage.
   */
  async uploadDesign(
    orderId: string,
    itemId: string,
    file: UploadedFile,
    catatanTeks: string | undefined,
    actor: JwtPayload,
  ): Promise<Prisma.OrderDesignGetPayload<object>> {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }

    const item = await prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
    });
    if (!item) {
      throw new NotFoundException('Item tidak ditemukan dalam order ini');
    }

    await this.productionService.assertDesignRevisionAllowed(item.id);

    // Validasi file (tipe & ukuran)
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Tipe file tidak diizinkan. Gunakan: JPEG, PNG, WebP, atau PDF.',
      );
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new BadRequestException('Ukuran file maksimal 10MB');
    }

    const fileUrl = `/uploads/designs/${orderId}/${itemId}/${file.originalname}`;

    return this.createDesignRecord(orderId, item, item.productType, fileUrl, catatanTeks, actor);
  }

  /**
   * Upload design dengan URL langsung (file sudah di-save di controller).
   */
  async uploadDesignWithUrl(
    orderId: string,
    itemId: string,
    fileUrl: string,
    catatanTeks: string | undefined,
    actor: JwtPayload,
  ): Promise<Prisma.OrderDesignGetPayload<object>> {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }

    const item = await prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
    });
    if (!item) {
      throw new NotFoundException('Item tidak ditemukan dalam order ini');
    }

    await this.productionService.assertDesignRevisionAllowed(item.id);

    return this.createDesignRecord(orderId, item, item.productType, fileUrl, catatanTeks, actor);
  }

  /**
   * Helper: buat record desain dan timeline event.
   * Fase 12: panggil ai-gateway untuk analisis desain (non-blocking, fallback-safe).
   */
  private async createDesignRecord(
    orderId: string,
    item: any,
    productType: string,
    fileUrl: string,
    catatanTeks: string | undefined,
    actor: JwtPayload,
  ) {
    const latestDesign = await prisma.orderDesign.findFirst({
      where: { orderItemId: item.id },
      orderBy: { versiRevisi: 'desc' },
      select: { versiRevisi: true },
    });
    const versiRevisi = (latestDesign?.versiRevisi ?? 0) + 1;

    const design = await prisma.orderDesign.create({
      data: {
        orderItemId: item.id,
        fileUrl,
        catatanTeks: catatanTeks ?? null,
        statusKonfirmasi: 'MENUNGGU',
        versiRevisi,
      },
    });

    // Timeline event
    await prisma.orderTimelineEvent.create({
      data: {
        orderId,
        tipeEvent: 'DESAIN_DIUPLOAD',
        deskripsi: `Desain revisi v${versiRevisi} diupload untuk item ${productType}`,
        actorId: actor.sub,
      },
    });

    // Fase 12: panggil ai-gateway untuk analisis desain (synchronous with timeout)
    // AI selalu asistif — kalau gagal, desain tetap tersimpan tanpa hasil AI
    const aiResult = await this.analyzeDesignWithAi(design.id, productType, catatanTeks, actor.sub);

    if (aiResult !== undefined) {
      // Update design with AI result
      const updatedDesign = await prisma.orderDesign.update({
        where: { id: design.id },
        data: { hasilEkstraksiAi: (aiResult ?? null) as any },
      });
      return updatedDesign;
    }

    return design;
  }

  /**
   * Panggil ai-gateway untuk analisis desain (Fase 12).
   * Fallback-safe: kalau ai-gateway gagal/timeout, return undefined.
   * Timeout 10 detik — AI tidak boleh memblokir alur inti (§17.5).
   */
  private async analyzeDesignWithAi(
    designId: string,
    productType: string,
    catatanTeks: string | undefined,
    customerId: string,
  ): Promise<unknown | undefined> {
    const aiGatewayUrl = this.configService.get<string>('AI_GATEWAY_URL', 'http://localhost:3002');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000); // 10 detik timeout

      const response = await fetch(`${aiGatewayUrl}/ai/design-analyzer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Customer-ID': customerId,
        },
        body: JSON.stringify({
          catatanTeks: catatanTeks || undefined,
          productType,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.warn(`AI gateway returned ${response.status} for design ${designId}`);
        return undefined;
      }

      const data = (await response.json()) as { hasil_ekstraksi_ai: unknown };

      this.logger.log(`AI analysis completed for design ${designId}`);
      return data.hasil_ekstraksi_ai ?? undefined;
    } catch (error: any) {
      // AI selalu asistif, tidak pernah blocking (§17.4, §17.5)
      // Kalau ai-gateway gagal atau timeout, desain tetap jalan tanpa AI
      this.logger.warn(`AI gateway call failed for design ${designId}: ${error.message}`);
      return undefined;
    }
  }

  /**
   * PATCH /orders/:id/designs/:designId/confirm — Konfirmasi atau tolak hasil AI.
   * Pelanggan review hasil ekstraksi AI sebagai saran, bukan otomatis final (§17.4).
   */
  async confirmDesignAiResult(
    orderId: string,
    designId: string,
    statusKonfirmasi: 'DITERIMA' | 'DITOLAK',
    actor: JwtPayload,
  ) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }

    const design = await prisma.orderDesign.findUnique({ where: { id: designId } });
    if (!design) {
      throw new NotFoundException('Desain tidak ditemukan');
    }

    // Verify design belongs to this order
    const orderItem = await prisma.orderItem.findFirst({
      where: { id: design.orderItemId, orderId },
    });
    if (!orderItem) {
      throw new NotFoundException('Desain tidak termasuk dalam order ini');
    }

    const updated = await prisma.orderDesign.update({
      where: { id: designId },
      data: { statusKonfirmasi },
    });

    // Timeline event
    await prisma.orderTimelineEvent.create({
      data: {
        orderId,
        tipeEvent: 'DESAIN_DIKONFIRMASI',
        deskripsi: `Hasil analisis AI desain v${design.versiRevisi} ${statusKonfirmasi === 'DITERIMA' ? 'diterima' : 'ditolak'} oleh pelanggan`,
        actorId: actor.sub,
      },
    });

    return updated;
  }

  // ==========================================
  // Order Services (Layanan tambahan)
  // ==========================================

  /**
   * POST /orders/:id/items/:itemId/services — Tambah layanan tambahan.
   */
  async addOrderService(
    orderId: string,
    itemId: string,
    dto: AddOrderServiceDto,
    actor: JwtPayload,
  ) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (order.status !== 'DRAFT') {
      throw new BadRequestException('Hanya order berstatus DRAFT yang bisa ditambahkan layanan');
    }

    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }

    const item = await prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
    });
    if (!item) {
      throw new NotFoundException('Item tidak ditemukan dalam order ini');
    }

    const service = await prisma.orderService.create({
      data: {
        orderItemId: itemId,
        serviceType: dto.serviceType,
        lokasi: dto.lokasi ?? null,
        ukuran: dto.ukuran ?? null,
        tarif: dto.tarif,
      },
    });

    // Timeline event
    await prisma.orderTimelineEvent.create({
      data: {
        orderId,
        tipeEvent: 'LAYANAN_DITAMBAH',
        deskripsi: `Ditambahkan layanan ${dto.serviceType} (Rp ${dto.tarif.toLocaleString()})`,
        actorId: actor.sub,
      },
    });

    return service;
  }

  // ==========================================
  // Checkout — Stock Reservation
  // ==========================================

  /**
   * PATCH /orders/:id/status — Update status order (checkout flow).
   *
   * Transisi DRAFT → MENUNGGU_PEMBAYARAN_DP:
   * 1. Hitung kebutuhan material dari BOM × qty
   * 2. Reserve stock untuk setiap material secara ATOMIK
   * 3. Jika satu saja gagal, release semua yang sudah ter-reserve
   *
   * §15: Reservasi terjadi saat checkout dimulai.
   */
  async updateStatus(
    orderId: string,
    dto: UpdateOrderStatusDto,
    actor: JwtPayload,
  ): Promise<OrderResponseDto> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { sizes: true } } },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }

    const previousStatus = order.status;

    // ==========================================
    // Checkout: DRAFT → MENUNGGU_PEMBAYARAN_DP
    // ==========================================
    if (previousStatus === 'DRAFT' && dto.status === 'MENUNGGU_PEMBAYARAN_DP') {
      return this.executeCheckout(order, dto, actor);
    }

    // ==========================================
    // Antrean: MENUNGGU_PEMBAYARAN_DP → ANTREAN
    // Publish OrderConfirmed untuk trigger Production task generation
    // ==========================================
    if (previousStatus === 'MENUNGGU_PEMBAYARAN_DP' && dto.status === 'ANTREAN') {
      return this.moveToAntrean(order, actor);
    }

    // ==========================================
    // Pembatalan
    // ==========================================
    if (dto.status === 'DIBATALKAN') {
      return this.cancelOrder(order, dto.reason, actor);
    }

    // ==========================================
    // Transisi lain (placeholder — akan diimplementasi di fase berikutnya)
    // ==========================================
    throw new BadRequestException(
      `Transisi dari ${previousStatus} ke ${dto.status} belum diimplementasi`,
    );
  }

  /**
   * Execute checkout: hitung material + reserve stock atomik.
   */
  private async executeCheckout(
    order: Awaited<ReturnType<typeof prisma.order.findUnique>> & { items: any[] },
    dto: UpdateOrderStatusDto,
    actor: JwtPayload,
  ): Promise<OrderResponseDto> {
    this.logger.log(`Starting checkout for order ${order.orderNumber}`);

    // 1. Hitung total qty per item
    const itemQtys = order.items.map((item) => ({
      itemId: item.id,
      productType: item.productType,
      totalQty: item.sizes.reduce((sum: number, s: { qty: number }) => sum + s.qty, 0),
    }));

    // 2. Ambil BOM untuk setiap product type
    const bomByProductType = new Map<string, any[]>();
    for (const { productType } of itemQtys) {
      if (!bomByProductType.has(productType)) {
        try {
          const bom = await this.inventoryService.getBom(productType);
          bomByProductType.set(productType, bom);
        } catch (error) {
          throw new BadRequestException(`BOM untuk produk "${productType}" belum dikonfigurasi`);
        }
      }
    }

    // 3. Hitung kebutuhan material: BOM × qty
    const materialRequirements: Array<{
      materialId: string;
      materialNama: string;
      totalQty: number;
    }> = [];

    for (const { productType, totalQty } of itemQtys) {
      const bom = bomByProductType.get(productType)!;
      for (const bomItem of bom) {
        const existing = materialRequirements.find((r) => r.materialId === bomItem.materialId);
        const qtyNeeded = bomItem.qtyPerUnit * totalQty;
        if (existing) {
          existing.totalQty += qtyNeeded;
        } else {
          materialRequirements.push({
            materialId: bomItem.materialId,
            materialNama: bomItem.material.nama,
            totalQty: qtyNeeded,
          });
        }
      }
    }

    // 4. Delete existing order_materials (jika ada dari attempt sebelumnya)
    //    dan reserve baru
    const successfulReservations: string[] = [];

    try {
      // Atomic reservation dalam transaksi
      await prisma.$transaction(async (tx) => {
        // --- Auto-fill basePriceSnapshot dari ProductPriceList (Fase 10 Bagian 2) ---
        for (const item of order.items) {
          if (item.basePriceSnapshot === 0) {
            const priceRef = await tx.productPriceList.findUnique({
              where: { productType: item.productType },
            });
            if (priceRef) {
              await tx.orderItem.update({
                where: { id: item.id },
                data: { basePriceSnapshot: priceRef.hargaDasarPerPcs },
              });
              // Update local object so it updates details properly in this execution context
              item.basePriceSnapshot = priceRef.hargaDasarPerPcs;
            }
          }
        }

        // Hapus order_materials lama
        for (const item of order.items) {
          await tx.orderMaterial.deleteMany({
            where: { orderItemId: item.id },
          });
        }

        // Reserve stock dan catat di order_materials
        for (const req of materialRequirements) {
          // Panggil InventoryService untuk reserve (sync, bukan event)
          const reserveDto: ReserveStockDto = {
            orderId: order.id,
            materialId: req.materialId,
            qty: req.totalQty,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Fase 11: TTL 24 jam
          };

          try {
            // reserveStock sudah transactional, tapi kita perlu handle
            // jika satu gagal, yang lain ikut di-rollback
            const reservation = await this.inventoryService.reserveStock(reserveDto);
            successfulReservations.push(reservation.id);

            // Catat di order_materials
            for (const item of order.items) {
              // Hitung qty untuk item ini saja
              const itemData = itemQtys.find((iq) => iq.itemId === item.id);
              if (itemData) {
                const bom = bomByProductType.get(itemData.productType)!;
                const bomItem = bom.find((b) => b.materialId === req.materialId);
                if (bomItem) {
                  await tx.orderMaterial.create({
                    data: {
                      orderItemId: item.id,
                      materialId: req.materialId,
                      qtyRequired: bomItem.qtyPerUnit * itemData.totalQty,
                    },
                  });
                }
              }
            }
          } catch (reserveError: any) {
            // Simpan info error untuk rollback
            throw {
              type: 'RESERVATION_FAILED',
              message: reserveError.message,
              materialId: req.materialId,
              materialNama: req.materialNama,
              requested: req.totalQty,
            };
          }
        }

        // Update status order
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'MENUNGGU_PEMBAYARAN_DP' },
        });

        // Timeline event
        await tx.orderTimelineEvent.create({
          data: {
            orderId: order.id,
            tipeEvent: 'CHECKOUT',
            deskripsi: `Checkout berhasil. ${materialRequirements.length} material di-reserve.`,
            actorId: actor.sub,
          },
        });
      });

      // 5. Publish event
      await this.eventBus.publish(
        EVENT_NAMES.OrderStatusChanged,
        new OrderStatusChangedEvent(
          order.id,
          order.orderNumber,
          'DRAFT',
          'MENUNGGU_PEMBAYARAN_DP',
          new Date(),
        ),
      );

      // CATATAN Fase 6: OrderConfirmed TIDAK lagi dipublish saat checkout.
      // Order baru "confirmed" saat DP dibayar (transisi ke ANTREAN) — §7.2.
      // Publish di sini menyebabkan Inventory melakukan deduction dan
      // Production generate task SEBELUM pembayaran (bug pra-Fase 6:
      // OrderConfirmed dipublish dobel di checkout dan di DP sukses).

      this.logger.log(`Checkout successful for order ${order.orderNumber}`);

      // Activity Log (§6.8): perubahan status order = aksi penting
      await this.activityLog.log(
        actor.sub,
        actor.role ?? null,
        `Order ${order.orderNumber} checkout — status DRAFT → MENUNGGU_PEMBAYARAN_DP`,
        'Order',
        order.id,
      );

      return this.getOrderById(order.id, actor);
    } catch (error: any) {
      // 6. Rollback: release semua reservation yang sudah berhasil
      if (successfulReservations.length > 0) {
        this.logger.warn(
          `Checkout failed for order ${order.orderNumber}, rolling back ${successfulReservations.length} reservations`,
        );
        await this.releaseReservations(successfulReservations);
      }

      // Format error message
      const errorInfo = error.type === 'RESERVATION_FAILED' ? error : null;
      const message = errorInfo
        ? `Stok tidak mencukupi untuk material "${errorInfo.materialNama}". Tersedia tidak cukup untuk memenuhi permintaan.`
        : error.message || 'Checkout gagal';

      throw new BadRequestException({
        message,
        details: errorInfo
          ? {
              materialId: errorInfo.materialId,
              materialNama: errorInfo.materialNama,
              requested: errorInfo.requested,
            }
          : undefined,
      });
    }
  }

  /**
   * Move order ke ANTREAN dan emit OrderConfirmed.
   *
   * §7.1: OrderConfirmed memicu Production Domain untuk generate tasks.
   * §23: Kriteria selesai Fase 4.
   */
  private async moveToAntrean(
    order: Awaited<ReturnType<typeof prisma.order.findUnique>> & { items: any[] },
    actor: JwtPayload,
  ): Promise<OrderResponseDto> {
    // Update status ke ANTREAN
    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'ANTREAN' },
    });

    // Timeline event
    await prisma.orderTimelineEvent.create({
      data: {
        orderId: order.id,
        tipeEvent: 'ANTREAN',
        deskripsi: `Order masuk antrean produksi`,
        actorId: actor.sub,
      },
    });

    // Publish OrderConfirmed event — Production Domain akan trigger task generation
    await this.eventBus.publish(
      EVENT_NAMES.OrderConfirmed,
      new OrderConfirmedEvent(order.id, order.orderNumber, order.customerId, new Date()),
    );

    this.logger.log(`Order ${order.orderNumber} moved to ANTREAN, OrderConfirmed published`);

    // Activity Log (§6.8): perubahan status order
    await this.activityLog.log(
      actor.sub,
      actor.role ?? null,
      `Order ${order.orderNumber} masuk antrean produksi — status → ANTREAN`,
      'Order',
      order.id,
    );

    return this.getOrderById(order.id, actor);
  }

  /**
   * Cancel order dan release semua stock reservations.
   */
  private async cancelOrder(
    order: Awaited<ReturnType<typeof prisma.order.findUnique>> & { items: any[] },
    reason: string | undefined,
    actor: JwtPayload,
  ): Promise<OrderResponseDto> {
    // Release semua stock reservations untuk order ini
    const reservations = await prisma.stockReservation.findMany({
      where: { orderId: order.id, status: 'ACTIVE' },
    });

    const releasedIds: string[] = [];
    for (const res of reservations) {
      try {
        await this.inventoryService.releaseStock({ reservationId: res.id });
        releasedIds.push(res.id);
      } catch (error) {
        this.logger.error(`Failed to release reservation ${res.id}: ${error}`);
      }
    }

    // Update status
    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'DIBATALKAN' },
    });

    // Timeline event
    await prisma.orderTimelineEvent.create({
      data: {
        orderId: order.id,
        tipeEvent: 'DIBATALKAN',
        deskripsi: `Order dibatalkan. ${releasedIds.length} reservasi dirilis.${reason ? ` Alasan: ${reason}` : ''}`,
        actorId: actor.sub,
      },
    });

    // Publish event
    await this.eventBus.publish(
      EVENT_NAMES.OrderCancelled,
      new OrderCancelledEvent(order.id, order.orderNumber, order.customerId, reason, new Date()),
    );

    // Activity Log (§6.8): pembatalan order = aksi penting
    await this.activityLog.log(
      actor.sub,
      actor.role ?? null,
      `Order ${order.orderNumber} dibatalkan${reason ? ` — ${reason}` : ''}`,
      'Order',
      order.id,
    );

    return this.getOrderById(order.id, actor);
  }

  // ==========================================
  // Konsumsi Event (dipanggil oleh OrderEventsProcessor)
  // ==========================================

  /**
   * Konsumen PaymentSucceeded (§7.2).
   * - DP sukses      → status ANTREAN + publish OrderConfirmed (memicu
   *   Production generate tasks & Inventory deduction lewat event bus).
   * - Pelunasan sukses → status LUNAS.
   *
   * IDEMPOTEN (§16): cek status order di DB dulu — event yang dikirim
   * dua kali tidak menghasilkan transisi/timeline/publish ganda.
   */
  async handlePaymentSucceeded(event: {
    paymentId: string;
    orderId: string;
    jenis: 'DP' | 'PELUNASAN';
    jumlah: number;
    customerId: string;
  }): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: event.orderId },
    });

    if (!order) {
      this.logger.warn(`Order not found: ${event.orderId}`);
      return;
    }

    if (event.jenis === 'DP') {
      // Idempotency: DP hanya boleh mentransisikan order yang masih
      // menunggu pembayaran DP. Status lain = sudah diproses / tidak relevan.
      if (order.status !== 'MENUNGGU_PEMBAYARAN_DP' && order.status !== 'DRAFT') {
        this.logger.log(
          `PaymentSucceeded(DP) for order ${order.orderNumber} skipped — status sudah ${order.status} (idempotent no-op)`,
        );
        return;
      }

      await prisma.order.update({
        where: { id: event.orderId },
        data: { status: 'ANTREAN' },
      });

      await prisma.orderTimelineEvent.create({
        data: {
          orderId: event.orderId,
          tipeEvent: 'ORDER_CONFIRMED',
          deskripsi: `Pembayaran DP Rp ${event.jumlah.toLocaleString()} berhasil. Order masuk antrean produksi.`,
        },
      });

      // Publish OrderConfirmed → Production (generate tasks),
      // Inventory (kunci reservasi → deduction), Notification (§7.2)
      await this.eventBus.publish(
        EVENT_NAMES.OrderConfirmed,
        new OrderConfirmedEvent(order.id, order.orderNumber, order.customerId, new Date()),
      );

      // Activity Log (§6.8): status berubah otomatis oleh sistem (DP sukses)
      await this.activityLog.log(
        null,
        'SYSTEM',
        `Order ${order.orderNumber} masuk antrean produksi — pembayaran DP diterima`,
        'Order',
        order.id,
      );

      this.logger.log(`Order ${order.orderNumber} transitioned to ANTREAN after DP payment`);
    } else if (event.jenis === 'PELUNASAN') {
      // Idempotency: skip jika sudah LUNAS/DIKIRIM
      if (order.status === 'LUNAS' || order.status === 'DIKIRIM') {
        this.logger.log(
          `PaymentSucceeded(PELUNASAN) for order ${order.orderNumber} skipped — status sudah ${order.status} (idempotent no-op)`,
        );
        return;
      }

      await prisma.order.update({
        where: { id: event.orderId },
        data: { status: 'LUNAS' },
      });

      await prisma.orderTimelineEvent.create({
        data: {
          orderId: event.orderId,
          tipeEvent: 'PELUNASAN_BAYAR',
          deskripsi: `Pembayaran pelunasan Rp ${event.jumlah.toLocaleString()} berhasil.`,
        },
      });

      // Activity Log (§6.8): status berubah otomatis oleh sistem
      await this.activityLog.log(
        null,
        'SYSTEM',
        `Order ${order.orderNumber} lunas — pembayaran pelunasan diterima`,
        'Order',
        order.id,
      );

      this.logger.log(`Order ${order.orderNumber} transitioned to LUNAS after pelunasan payment`);
    }
  }

  /**
   * Konsumen PaymentExpired (Fase 11): cancel order yang masih MENUNGGU_PEMBAYARAN_DP.
   * Release stok ditangani oleh InventoryEventsProcessor (sudah sejak Fase 6).
   *
   * IDEMPOTEN: skip jika order sudah bukan MENUNGGU_PEMBAYARAN_DP.
   */
  async handlePaymentExpired(event: {
    paymentId: string;
    orderId: string;
    orderNumber?: string;
    customerId?: string;
    customerNama?: string;
    customerNoHp?: string | null;
  }): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: event.orderId },
    });

    if (!order) {
      this.logger.warn(`Order not found: ${event.orderId}`);
      return;
    }

    // Idempotency: hanya proses order yang masih menunggu DP
    if (order.status !== 'MENUNGGU_PEMBAYARAN_DP') {
      this.logger.log(
        `PaymentExpired for order ${order.orderNumber} skipped — status sudah ${order.status} (idempotent no-op)`,
      );
      return;
    }

    await this.cancelOrderByFinance(
      event.orderId,
      'Pembayaran DP tidak diterima dalam batas waktu (Midtrans expired)',
    );

    // Publish ReservationExpired → WA notification ke pelanggan
    // (Fase 11: pastikan pelanggan dapat notifikasi terlepas dari jalur mana yang trigger duluan)
    await this.eventBus.publish(EVENT_NAMES.ReservationExpired, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      customerNama: event.customerNama ?? 'Pelanggan',
      customerNoHp: event.customerNoHp ?? null,
    });

    this.logger.log(`Order ${order.orderNumber} cancelled due to payment expiry`);
  }

  /**
   * Konsumen ProductionCompleted (§4): update progres order.
   * Status → MENUNGGU_PELUNASAN (produksi selesai, menunggu pembayaran sisa).
   *
   * IDEMPOTEN: skip jika status sudah MENUNGGU_PELUNASAN atau lebih lanjut.
   */
  async handleProductionCompleted(event: { orderId: string; orderNumber: string }): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: event.orderId },
    });

    if (!order) {
      this.logger.warn(`Order not found: ${event.orderId}`);
      return;
    }

    const terminalStatuses = ['MENUNGGU_PELUNASAN', 'LUNAS', 'DIKIRIM', 'DIBATALKAN'];
    if (terminalStatuses.includes(order.status)) {
      this.logger.log(
        `ProductionCompleted for order ${order.orderNumber} skipped — status sudah ${order.status} (idempotent no-op)`,
      );
      return;
    }

    await prisma.order.update({
      where: { id: event.orderId },
      data: { status: 'MENUNGGU_PELUNASAN' },
    });

    await prisma.orderTimelineEvent.create({
      data: {
        orderId: event.orderId,
        tipeEvent: 'PRODUKSI_SELESAI',
        deskripsi: `Produksi selesai. Order menunggu pelunasan.`,
      },
    });

    this.logger.log(`Order ${order.orderNumber} transitioned to MENUNGGU_PELUNASAN`);
  }

  /**
   * Konsumen ShipmentCreated (§7.1): transisi order → DIKIRIM.
   *
   * Trigger: Staff membuat shipment setelah barang handed over ke kurir.
   * Efek: Order status → DIKIRIM (sesuai §25.1 alur order).
   *
   * IDEMPOTEN: skip jika status sudah DIKIRIM atau lebih lanjut (LUNAS→DIKIRIM).
   */
  async handleShipmentCreated(event: {
    shipmentId: string;
    orderId: string;
    orderNumber: string;
    kurir: string;
    trackingToken: string;
    createdAt: Date;
  }): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: event.orderId },
    });

    if (!order) {
      this.logger.warn(`Order not found: ${event.orderId}`);
      return;
    }

    // Idempotency: skip jika sudah DIKIRIM
    if (order.status === 'DIKIRIM') {
      this.logger.log(
        `ShipmentCreated for order ${order.orderNumber} skipped — status sudah DIKIRIM (idempotent no-op)`,
      );
      return;
    }

    // Validasi status: hanya LUNAS yang boleh ditransisi ke DIKIRIM
    if (order.status !== 'LUNAS') {
      this.logger.warn(
        `ShipmentCreated for order ${order.orderNumber} skipped — status ${order.status} (hanya LUNAS yang boleh transit ke DIKIRIM)`,
      );
      return;
    }

    await prisma.order.update({
      where: { id: event.orderId },
      data: { status: 'DIKIRIM' },
    });

    await prisma.orderTimelineEvent.create({
      data: {
        orderId: event.orderId,
        tipeEvent: 'DIKIRIM',
        deskripsi: `Order dikirim via ${event.kurir}. Tracking token: ${event.trackingToken}`,
      },
    });

    this.logger.log(
      `Order ${order.orderNumber} transitioned to DIKIRIM (shipment: ${event.shipmentId})`,
    );
  }

  /**
   * Konsumen ShipmentDelivered (§7.1): catat event di timeline.
   *
   * Trigger: Staff update shipment status → DITERIMA.
   * Efek: Timeline event dicatat (tidak ada transisi status Order karena DIKIRIM sudah final).
   *
   * IDEMPOTEN: tidak ada efek jika sudah delivered.
   */
  async handleShipmentDelivered(event: {
    shipmentId: string;
    orderId: string;
    orderNumber: string;
    deliveredAt: Date;
  }): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: event.orderId },
    });

    if (!order) {
      this.logger.warn(`Order not found: ${event.orderId}`);
      return;
    }

    // Catat di timeline (tidak ada perubahan status Order)
    await prisma.orderTimelineEvent.create({
      data: {
        orderId: event.orderId,
        tipeEvent: 'DITERIMA',
        deskripsi: `Barang diterima pelanggan pada ${new Date(event.deliveredAt).toLocaleString('id-ID')}`,
      },
    });

    this.logger.log(`Order ${order.orderNumber} marked as delivered`);
  }

  // ==========================================
  // Finance Domain Integration (called by FinanceService)
  // All modifications go through OrderService to maintain DDD boundaries
  // ==========================================

  /**
   * Override item price (from Finance approval - HARGA_KHUSUS)
   */
  async overrideItemPrice(orderItemId: string, newPriceNote: string): Promise<void> {
    // Update base_price_snapshot with note stored in log
    await prisma.orderItem.update({
      where: { id: orderItemId },
      data: { basePriceSnapshot: 0 }, // Price will be recalculated on next invoice
    });

    this.logger.log(`Item price override requested for ${orderItemId}: ${newPriceNote}`);
  }

  /**
   * Apply discount (from Finance approval - DISKON)
   */
  async applyDiscount(orderId: string, discountNote: string): Promise<void> {
    // Parse discount amount from note (format: "Rp 50000" or "10%")
    let nominal = 0;
    let percentage = 0;

    if (discountNote.includes('%')) {
      percentage = parseFloat(discountNote.replace(/[^0-9.]/g, ''));
    } else {
      nominal = parseFloat(discountNote.replace(/[^0-9]/g, ''));
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        discountNominal: nominal > 0 ? nominal : undefined,
        discountPersen: percentage > 0 ? percentage : undefined,
      },
    });

    // Timeline event
    await prisma.orderTimelineEvent.create({
      data: {
        orderId,
        tipeEvent: 'DISKON_APPLIED',
        deskripsi: `Diskon diterapkan. ${nominal > 0 ? `Rp ${nominal.toLocaleString()}` : `${percentage}%`}`,
      },
    });
  }

  /**
   * Reissue invoice (from Finance approval - EDIT_INVOICE)
   */
  async reissueInvoice(invoiceId: string): Promise<void> {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) return;

    // Archive old invoice
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'CANCELLED' },
    });

    // Timeline event
    await prisma.orderTimelineEvent.create({
      data: {
        orderId: invoice.orderId,
        tipeEvent: 'INVOICE_REISSUED',
        deskripsi: `Invoice ${invoice.jenis} diarsipkan, invoice baru diterbitkan`,
      },
    });
  }

  /**
   * Cancel order from Finance (for REFUND approval)
   * This is a simpler version that doesn't need the full actor context
   */
  async cancelOrderByFinance(orderId: string, reason?: string): Promise<void> {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'DIBATALKAN' },
    });

    // Timeline event
    await prisma.orderTimelineEvent.create({
      data: {
        orderId,
        tipeEvent: 'DIBATALKAN',
        deskripsi: `Order dibatalkan via approval refund.${reason ? ` Alasan: ${reason}` : ''}`,
      },
    });
  }

  /**
   * Release all stock reservations for an order (called by Finance for REFUND)
   */
  async releaseReservationsForOrder(orderId: string): Promise<number> {
    const reservations = await prisma.stockReservation.findMany({
      where: { orderId, status: 'ACTIVE' },
    });

    for (const res of reservations) {
      try {
        await this.inventoryService.releaseStock({ reservationId: res.id });
      } catch (error) {
        this.logger.error(`Failed to release reservation ${res.id}: ${error}`);
      }
    }

    return reservations.length;
  }

  /**
   * Release multiple reservations (for rollback on checkout failure).
   */
  private async releaseReservations(reservationIds: string[]) {
    for (const id of reservationIds) {
      try {
        await this.inventoryService.releaseStock({ reservationId: id });
      } catch (error) {
        this.logger.error(`Failed to release reservation ${id} during rollback: ${error}`);
      }
    }
  }

  // ==========================================
  // Duplicate Order (Repeat)
  // ==========================================

  /**
   * POST /orders/:id/duplicate — Duplikasi order untuk repeat order.
   */
  async duplicateOrder(orderId: string, actor: JwtPayload): Promise<OrderResponseDto> {
    const originalOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            sizes: true,
            designs: true,
            services: true,
            materials: true,
          },
        },
      },
    });

    if (!originalOrder) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    // Cek akses
    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== originalOrder.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }

    const productTypes = [...new Set(originalOrder.items.map((item) => item.productType))];
    const currentPrices = await Promise.all(
      productTypes.map((productType) =>
        prisma.productPriceList.findUnique({ where: { productType } }),
      ),
    );
    const priceByProduct = new Map(
      currentPrices
        .filter((price): price is NonNullable<typeof price> => price !== null)
        .map((price) => [price.productType, price.hargaDasarPerPcs]),
    );

    // Buat order baru
    const newOrderNumber = await this.generateOrderNumber();

    const newOrder = await prisma.order.create({
      data: {
        orderNumber: newOrderNumber,
        customerId: originalOrder.customerId,
        status: 'DRAFT',
        deadline: null,
        items: {
          create: originalOrder.items.map((item) => {
            const latestDesign = [...item.designs].sort((a, b) => b.versiRevisi - a.versiRevisi)[0];
            return {
              productType: item.productType,
              basePriceSnapshot: priceByProduct.get(item.productType) ?? item.basePriceSnapshot,
              sizes: {
                create: item.sizes.map((size) => ({ ukuran: size.ukuran, qty: size.qty })),
              },
              designs: latestDesign
                ? {
                    create: [
                      {
                        fileUrl: latestDesign.fileUrl,
                        catatanTeks: latestDesign.catatanTeks,
                        statusKonfirmasi: 'MENUNGGU',
                        versiRevisi: 1,
                      },
                    ],
                  }
                : undefined,
              services: {
                create: item.services.map((service) => ({
                  serviceType: service.serviceType,
                  lokasi: service.lokasi,
                  ukuran: service.ukuran,
                  tarif: service.tarif,
                })),
              },
            };
          }),
        },
      },
      include: {
        items: {
          include: {
            sizes: true,
            designs: true,
            materials: true, // Plain FK, join manually below
            services: true,
          },
        },
        timeline: true,
        payments: true,
        invoices: true,
        shipments: true,
      },
    });

    // Fetch material names for duplicated order
    const materialIds = [
      ...new Set(newOrder.items.flatMap((item) => item.materials.map((m) => m.materialId))),
    ];
    const materials = await prisma.material.findMany({
      where: { id: { in: materialIds } },
    });
    const materialMap = new Map(materials.map((m) => [m.id, m]));

    // Attach material data
    newOrder.items.forEach((item) => {
      item.materials = item.materials.map((m) => ({
        ...m,
        material: materialMap.get(m.materialId),
      }));
    });

    // Timeline event
    await prisma.orderTimelineEvent.create({
      data: {
        orderId: newOrder.id,
        tipeEvent: 'DIBUAT',
        deskripsi: `Order ${newOrderNumber} dibuat sebagai duplikat dari ${originalOrder.orderNumber}`,
        actorId: actor.sub,
      },
    });

    // Publish event
    await this.eventBus.publish(
      EVENT_NAMES.OrderCreated,
      new OrderCreatedEvent(
        newOrder.id,
        newOrder.orderNumber,
        newOrder.customerId,
        newOrder.createdAt,
      ),
    );

    return this.mapOrderToResponse(newOrder);
  }

  // ==========================================
  // Timeline
  // ==========================================

  /**
   * GET /orders/:id/timeline — Ambil timeline order.
   */
  async getTimeline(orderId: string, actor: JwtPayload) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }
    await this.assertPenjahitCanViewOrder(orderId, actor);

    const timeline = await prisma.orderTimelineEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });

    return timeline;
  }

  /**
   * §5.1 view terbatas: Tim Penjahit hanya boleh membuka order yang punya
   * task ditugaskan kepadanya. Cek via Production Domain (DDD boundary).
   */
  private async assertPenjahitCanViewOrder(orderId: string, actor: JwtPayload): Promise<void> {
    if (actor.actorType !== ActorType.USER || actor.role !== UserRole.TIM_PENJAHIT) {
      return;
    }
    const orderIds = await this.productionService.getOrderIdsForAssignee(actor.sub);
    if (!orderIds.includes(orderId)) {
      throw new ForbiddenException('Anda hanya bisa melihat order dengan task milik Anda');
    }
  }

  // ==========================================
  // Cross-Domain: Add Timeline Event (DDD Boundary)
  // ==========================================
  // Production Domain memanggil method ini untuk mencatat event ke Order Domain.
  // Production TIDAK BOLEH akses prisma.orderTimelineEvent.create() langsung.

  /**
   * Catat timeline event ke Order Domain.
   * Dipanggil oleh domain lain (mis. Production) untuk mencatat event produksi.
   *
   * @param orderId - ID order terkait
   * @param eventType - Tipe event (mis. 'TASK_SELESAI', 'PRODUKSI_SELESAI')
   * @param description - Deskripsi event
   * @param actorId - ID user yang memicu (opsional)
   */
  async addTimelineEvent(
    orderId: string,
    eventType: string,
    description: string,
    actorId?: string,
  ): Promise<void> {
    await prisma.orderTimelineEvent.create({
      data: {
        orderId,
        tipeEvent: eventType,
        deskripsi: description,
        actorId,
      },
    });
  }

  // ==========================================
  // Cross-Domain: Get Order Data (DDD Boundary)
  // ==========================================
  // Shipping Domain memanggil method ini untuk validasi order.
  // Shipping TIDAK BOLEH query prisma.order.findUnique() langsung.

  /**
   * Ambil data order minimal untuk validasi domain lain.
   * Mengembalikan data internal, BUKAN DTO response.
   *
   * @param orderId - ID order
   * @returns Data order { id, status, orderNumber, customerId, alamat } atau null jika tidak ada
   */
  async getOrderByIdInternal(orderId: string): Promise<{
    id: string;
    status: string;
    orderNumber: string;
    customerId: string;
    alamat: string | null;
  } | null> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        orderNumber: true,
        customerId: true,
        customer: {
          select: {
            alamat: true,
          },
        },
      },
    });

    if (!order) {
      return null;
    }

    return {
      id: order.id,
      status: order.status,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      alamat: order.customer.alamat,
    };
  }

  /**
   * Ambil konteks order lengkap untuk AI Customer Support (internal use only).
   *
   * Data yang dikembalikan (status, items, timeline) adalah yang dibutuhkan
   * CustomerChatService untuk membangun payload ke ai-gateway. Items sudah
   * aggregate qty dari semua ukuran supaya AI tidak perlu kalkulasi.
   *
   * Beda dengan `getOrderById(orderId, actor)` (endpoint publik):
   * - getOrderById → endpoint publik, return DTO lengkap + apply access rules
   * - getOrderContextForAi → internal call, return data minimal siap-konsumsi AI
   *   TANPA melakukan access check (caller — CustomerChatService — sudah
   *   validateAccess() di awal request, dengan ownership check dll).
   *
   * DDD §4.1: Caller TIDAK BOLEH query `prisma.order.findUnique` sendiri
   * untuk konteks ini.
   *
   * @returns null kalau order tidak ada
   */
  async getOrderContextForAi(orderId: string): Promise<{
    orderNumber: string;
    status: string;
    items: Array<{ productType: string; qty: number; basePriceSnapshot: number }>;
    timeline: Array<{ tipeEvent: string; deskripsi: string; createdAt: string }>;
  } | null> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { sizes: true } },
        timeline: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!order) return null;

    return {
      orderNumber: order.orderNumber,
      status: order.status,
      items: order.items.map((item) => ({
        productType: item.productType,
        qty: item.sizes.reduce((sum, s) => sum + s.qty, 0),
        basePriceSnapshot: item.basePriceSnapshot,
      })),
      timeline: order.timeline.map((t) => ({
        tipeEvent: t.tipeEvent,
        deskripsi: t.deskripsi,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }

  // ==========================================
  // Helpers
  // ==========================================

  /**
   * Generate order number: MLV-YYYYMMDD-XXXX
   * XXXX = increment harian, reset setiap hari.
   */
  private async generateOrderNumber(): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD

    // Hitung jumlah order hari ini
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const countToday = await prisma.order.count({
      where: {
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    const seq = (countToday + 1).toString().padStart(4, '0');
    return `MLV-${dateStr}-${seq}`;
  }

  /**
   * Cek ketersediaan stok real-time (panggil InventoryService).
   */
  async checkAvailability(
    productType: string,
    qty: number,
  ): Promise<{ available: boolean; estimation?: string }> {
    return this.inventoryService.checkAvailability(productType, qty);
  }

  /**
   * Map Prisma order to response DTO.
   */
  private mapOrderToResponse(
    order: any,
    revisionEligibility: Record<
      string,
      { allowed: boolean; cuttingStatus: string | null; reason: string | null }
    > = {},
  ): OrderResponseDto {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      status: order.status,
      deadline: order.deadline,
      items: order.items.map((item: any) => ({
        id: item.id,
        productType: item.productType,
        basePriceSnapshot: item.basePriceSnapshot,
        sizes: item.sizes.map((s: any) => ({
          id: s.id,
          ukuran: s.ukuran,
          qty: s.qty,
        })),
        designs: item.designs.map((d: any) => ({
          id: d.id,
          fileUrl: d.fileUrl,
          catatanTeks: d.catatanTeks,
          hasilEkstraksiAi: d.hasilEkstraksiAi,
          statusKonfirmasi: d.statusKonfirmasi,
          versiRevisi: d.versiRevisi,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        })),
        materials: item.materials.map((m: any) => ({
          id: m.id,
          materialId: m.materialId,
          materialNama: m.material?.nama ?? '',
          qtyRequired: m.qtyRequired,
        })),
        services: item.services.map((s: any) => ({
          id: s.id,
          serviceType: s.serviceType,
          lokasi: s.lokasi,
          ukuran: s.ukuran,
          tarif: s.tarif,
        })),
        designRevision: revisionEligibility[item.id] ?? {
          allowed: true,
          cuttingStatus: null,
          reason: null,
        },
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      timeline: order.timeline.map((t: any) => ({
        id: t.id,
        tipeEvent: t.tipeEvent,
        deskripsi: t.deskripsi,
        actorId: t.actorId,
        createdAt: t.createdAt,
      })),
      payments: (order.payments ?? []).map((payment: any) => ({
        id: payment.id,
        jenis: payment.jenis,
        metode: payment.metode,
        jumlah: payment.jumlah,
        status: payment.status,
        createdAt: payment.createdAt,
      })),
      invoices: (order.invoices ?? []).map((invoice: any) => ({
        id: invoice.id,
        jenis: invoice.jenis,
        jumlah: invoice.jumlah,
        status: invoice.status,
        pdfUrl: invoice.pdfUrl,
        createdAt: invoice.createdAt,
      })),
      shipment: (order.shipments ?? [])[0]
        ? {
            id: order.shipments[0].id,
            kurir: order.shipments[0].kurir,
            noResi: order.shipments[0].noResi,
            status: order.shipments[0].status,
            shippedAt: order.shipments[0].shippedAt,
            deliveredAt: order.shipments[0].deliveredAt,
            updatedAt: order.shipments[0].updatedAt,
          }
        : null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
