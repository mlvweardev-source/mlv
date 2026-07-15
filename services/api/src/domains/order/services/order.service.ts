import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { prisma } from '@mlv/db';
import type { Prisma } from '@mlv/db';
import { ActorType } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { InventoryService } from '../../inventory/services/inventory.service';
import { ReserveStockDto } from '../../inventory/dto/inventory.dto';
import {
  CreateOrderDto,
  AddOrderItemDto,
  UpdateOrderStatusDto,
  AddOrderServiceDto,
  AddOrderItemResponseDto,
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
    private readonly eventEmitter: EventEmitter2,
    private readonly inventoryService: InventoryService,
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
    this.eventEmitter.emit(
      OrderCreatedEvent.eventName,
      new OrderCreatedEvent(order.id, order.orderNumber, order.customerId, order.createdAt),
    );

    return this.getOrderById(order.id, actor);
  }

  /**
   * GET /orders — Daftar order.
   * Staff: lihat semua. Pelanggan: lihat miliknya sendiri.
   */
  async findOrders(actor: JwtPayload): Promise<OrderListResponseDto[]> {
    const whereClause = actor.actorType === ActorType.CUSTOMER ? { customerId: actor.sub } : {};

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
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
      },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    // Cek akses
    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }

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

    return this.mapOrderToResponse(order);
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

    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productType: dto.productType,
        basePriceSnapshot: dto.basePriceSnapshot,
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

    return this.createDesignRecord(orderId, item, item.productType, fileUrl, catatanTeks, actor);
  }

  /**
   * Helper: buat record desain dan timeline event.
   */
  private async createDesignRecord(
    orderId: string,
    item: any,
    productType: string,
    fileUrl: string,
    catatanTeks: string | undefined,
    actor: JwtPayload,
  ) {
    const design = await prisma.orderDesign.create({
      data: {
        orderItemId: item.id,
        fileUrl,
        catatanTeks: catatanTeks ?? null,
        statusKonfirmasi: 'MENUNGGU',
        versiRevisi: 1,
      },
    });

    // Timeline event
    await prisma.orderTimelineEvent.create({
      data: {
        orderId,
        tipeEvent: 'DESAIN_DIUPLOAD',
        deskripsi: `Desain diupload untuk item ${productType}`,
        actorId: actor.sub,
      },
    });

    return design;
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
      this.eventEmitter.emit(
        OrderStatusChangedEvent.eventName,
        new OrderStatusChangedEvent(
          order.id,
          order.orderNumber,
          'DRAFT',
          'MENUNGGU_PEMBAYARAN_DP',
          new Date(),
        ),
      );

      this.eventEmitter.emit(
        OrderConfirmedEvent.eventName,
        new OrderConfirmedEvent(order.id, order.orderNumber, order.customerId, new Date()),
      );

      this.logger.log(`Checkout successful for order ${order.orderNumber}`);

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
    this.eventEmitter.emit(
      OrderConfirmedEvent.eventName,
      new OrderConfirmedEvent(order.id, order.orderNumber, order.customerId, new Date()),
    );

    this.logger.log(`Order ${order.orderNumber} moved to ANTREAN, OrderConfirmed published`);

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
    this.eventEmitter.emit(
      OrderCancelledEvent.eventName,
      new OrderCancelledEvent(order.id, order.orderNumber, order.customerId, reason, new Date()),
    );

    return this.getOrderById(order.id, actor);
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

    // Buat order baru
    const newOrderNumber = await this.generateOrderNumber();

    const newOrder = await prisma.order.create({
      data: {
        orderNumber: newOrderNumber,
        customerId: originalOrder.customerId,
        status: 'DRAFT',
        deadline: null,
        items: {
          create: originalOrder.items.map((item) => ({
            productType: item.productType,
            basePriceSnapshot: item.basePriceSnapshot,
            sizes: {
              create: item.sizes.map((s) => ({
                ukuran: s.ukuran,
                qty: s.qty,
              })),
            },
          })),
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
    this.eventEmitter.emit(
      OrderCreatedEvent.eventName,
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

    const timeline = await prisma.orderTimelineEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });

    return timeline;
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
   * Map Prisma order to response DTO.
   */
  private mapOrderToResponse(order: any): OrderResponseDto {
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
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}
