import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { prisma } from '@mlv/db';
import { EVENT_NAMES } from '@mlv/types';
import { EventBusService } from '../../../event-bus/event-bus.service';
import {
  CreateMaterialDto,
  CreateBomDto,
  ReserveStockDto,
  ReleaseStockDto,
  CreateStockMovementDto,
  CreatePurchaseOrderDto,
  CreateStockAdjustmentDto,
} from '../dto/inventory.dto';
import {
  StockReservedEvent,
  StockReservationReleasedEvent,
  StockDeductedEvent,
  StockLowEvent,
} from '../events/inventory.events';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly eventBus: EventBusService) {}

  // ==========================================
  // Material Master Data
  // ==========================================

  async createMaterial(dto: CreateMaterialDto) {
    return prisma.material.create({
      data: {
        nama: dto.nama,
        satuan: dto.satuan,
        kategori: dto.kategori,
      },
    });
  }

  async findMaterials() {
    return prisma.material.findMany({
      orderBy: { nama: 'asc' },
    });
  }

  // ==========================================
  // Bill of Materials (BOM)
  // ==========================================

  async createBom(dto: CreateBomDto) {
    const material = await prisma.material.findUnique({
      where: { id: dto.materialId },
    });
    if (!material) {
      throw new NotFoundException('Material tidak ditemukan');
    }

    return prisma.billOfMaterial.upsert({
      where: {
        productType_materialId: {
          productType: dto.productType,
          materialId: dto.materialId,
        },
      },
      update: {
        qtyPerUnit: dto.qtyPerUnit,
      },
      create: {
        productType: dto.productType,
        materialId: dto.materialId,
        qtyPerUnit: dto.qtyPerUnit,
      },
    });
  }

  async getBom(productType: string) {
    const boms = await prisma.billOfMaterial.findMany({
      where: { productType },
      include: {
        material: true,
      },
    });

    if (boms.length === 0) {
      throw new NotFoundException(`BOM untuk tipe produk "${productType}" tidak ditemukan`);
    }

    return boms;
  }

  /** Semua BOM (Fase 9 UI): dikelompokkan per product type di frontend. */
  async findAllBoms() {
    return prisma.billOfMaterial.findMany({
      include: { material: true },
      orderBy: [{ productType: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // ==========================================
  // Stock Balance & Cache
  // ==========================================

  async getStockBalances() {
    return prisma.stockBalance.findMany({
      include: {
        material: true,
        warehouse: true,
      },
    });
  }

  // ==========================================
  // Stock Reservation (Row-locking concurrency safe)
  // ==========================================

  async reserveStock(dto: ReserveStockDto) {
    const { orderId, materialId, qty } = dto;

    const warehouse = await prisma.warehouse.findFirst();
    if (!warehouse) {
      throw new NotFoundException('Gudang default tidak ditemukan. Jalankan seed terlebih dahulu.');
    }
    const warehouseId = warehouse.id;

    const reservation = await prisma.$transaction(async (tx) => {
      // 1. Pastikan record stock_balances ada sebelum di-lock
      const balanceExists = await tx.stockBalance.findUnique({
        where: {
          materialId_warehouseId: { materialId, warehouseId },
        },
      });

      if (!balanceExists) {
        await tx.stockBalance.create({
          data: {
            materialId,
            warehouseId,
            qtyAvailable: 0,
            qtyReserved: 0,
          },
        });
      }

      // 2. Lock row menggunakan SELECT ... FOR UPDATE
      const balances = await tx.$queryRaw<any[]>`
        SELECT * FROM "stock_balances"
        WHERE "material_id" = ${materialId} AND "warehouse_id" = ${warehouseId}
        FOR UPDATE
      `;
      const balance = balances[0];
      if (!balance) {
        throw new NotFoundException('Saldo stok tidak ditemukan setelah inisialisasi');
      }

      const available = Number(balance.qty_available ?? balance.qtyAvailable ?? 0);
      const reserved = Number(balance.qty_reserved ?? balance.qtyReserved ?? 0);

      // Cek ketersediaan
      if (available - reserved < qty) {
        throw new BadRequestException(
          `Stok tidak mencukupi untuk material ini. Tersedia: ${available - reserved}, Diminta: ${qty}`,
        );
      }

      // 3. Buat reservasi
      const expiresAt = dto.expiresAt
        ? new Date(dto.expiresAt)
        : new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 jam (Fase 11: samakan dengan Midtrans expiry)
      const newReservation = await tx.stockReservation.create({
        data: {
          orderId,
          materialId,
          qty,
          status: 'ACTIVE',
          expiresAt,
        },
      });

      // 4. Catat stock movement tipe RESERVE
      await tx.stockMovement.create({
        data: {
          materialId,
          warehouseId,
          tipe: 'RESERVE',
          qty,
          refType: 'reservation',
          refId: newReservation.id,
        },
      });

      // 5. Update qty_reserved di balance cache
      await tx.stockBalance.update({
        where: {
          materialId_warehouseId: { materialId, warehouseId },
        },
        data: {
          qtyReserved: reserved + qty,
        },
      });

      return newReservation;
    });

    // 6. Publish event SETELAH transaksi commit — event tidak boleh
    //    terkirim untuk transaksi yang di-rollback (BullMQ = network I/O)
    await this.eventBus.publish(
      EVENT_NAMES.StockReserved,
      new StockReservedEvent(
        reservation.id,
        reservation.orderId,
        reservation.materialId,
        reservation.qty,
        reservation.expiresAt,
      ),
    );

    return reservation;
  }

  async releaseStock(dto: ReleaseStockDto) {
    const warehouse = await prisma.warehouse.findFirst();
    if (!warehouse) {
      throw new NotFoundException('Gudang default tidak ditemukan');
    }
    const warehouseId = warehouse.id;

    const { updatedReservation, reservation } = await prisma.$transaction(async (tx) => {
      const currentReservation = await tx.stockReservation.findUnique({
        where: { id: dto.reservationId },
      });

      if (!currentReservation) {
        throw new NotFoundException('Reservasi tidak ditemukan');
      }

      if (currentReservation.status !== 'ACTIVE') {
        throw new BadRequestException(
          `Reservasi sudah tidak aktif (status saat ini: ${currentReservation.status})`,
        );
      }

      // Lock row
      const balances = await tx.$queryRaw<any[]>`
        SELECT * FROM "stock_balances"
        WHERE "material_id" = ${currentReservation.materialId} AND "warehouse_id" = ${warehouseId}
        FOR UPDATE
      `;
      const balance = balances[0];
      if (!balance) {
        throw new NotFoundException('Saldo stok tidak ditemukan');
      }

      const reserved = Number(balance.qty_reserved ?? balance.qtyReserved ?? 0);

      // Update status
      const updated = await tx.stockReservation.update({
        where: { id: currentReservation.id },
        data: { status: 'RELEASED' },
      });

      // Write movement
      await tx.stockMovement.create({
        data: {
          materialId: currentReservation.materialId,
          warehouseId,
          tipe: 'RELEASE',
          qty: currentReservation.qty,
          refType: 'reservation',
          refId: currentReservation.id,
        },
      });

      // Update balance
      await tx.stockBalance.update({
        where: {
          materialId_warehouseId: {
            materialId: currentReservation.materialId,
            warehouseId,
          },
        },
        data: {
          qtyReserved: Math.max(0, reserved - currentReservation.qty),
        },
      });

      return { updatedReservation: updated, reservation: currentReservation };
    });

    // Publish event setelah transaksi commit
    await this.eventBus.publish(
      EVENT_NAMES.StockReservationReleased,
      new StockReservationReleasedEvent(
        reservation.id,
        reservation.orderId,
        reservation.materialId,
        reservation.qty,
      ),
    );

    return updatedReservation;
  }

  async deductStock(reservationId: string) {
    const warehouse = await prisma.warehouse.findFirst();
    if (!warehouse) {
      throw new NotFoundException('Gudang default tidak ditemukan');
    }
    const warehouseId = warehouse.id;

    const { updatedReservation, reservation, newAvailable } = await prisma.$transaction(
      async (tx) => {
        const currentReservation = await tx.stockReservation.findUnique({
          where: { id: reservationId },
        });

        if (!currentReservation) {
          throw new NotFoundException('Reservasi tidak ditemukan');
        }

        if (currentReservation.status !== 'ACTIVE') {
          throw new BadRequestException(
            `Reservasi sudah tidak aktif (status saat ini: ${currentReservation.status})`,
          );
        }

        // Lock row
        const balances = await tx.$queryRaw<any[]>`
        SELECT * FROM "stock_balances"
        WHERE "material_id" = ${currentReservation.materialId} AND "warehouse_id" = ${warehouseId}
        FOR UPDATE
      `;
        const balance = balances[0];
        if (!balance) {
          throw new NotFoundException('Saldo stok tidak ditemukan');
        }

        const available = Number(balance.qty_available ?? balance.qtyAvailable ?? 0);
        const reserved = Number(balance.qty_reserved ?? balance.qtyReserved ?? 0);

        // Update status
        const updated = await tx.stockReservation.update({
          where: { id: reservationId },
          data: { status: 'CONSUMED' },
        });

        // Write movement (OUT)
        await tx.stockMovement.create({
          data: {
            materialId: currentReservation.materialId,
            warehouseId,
            tipe: 'OUT',
            qty: currentReservation.qty,
            refType: 'reservation',
            refId: currentReservation.id,
          },
        });

        // Update balance cache
        const nextAvailable = Math.max(0, available - currentReservation.qty);
        const nextReserved = Math.max(0, reserved - currentReservation.qty);

        await tx.stockBalance.update({
          where: {
            materialId_warehouseId: {
              materialId: currentReservation.materialId,
              warehouseId,
            },
          },
          data: {
            qtyAvailable: nextAvailable,
            qtyReserved: nextReserved,
          },
        });

        return {
          updatedReservation: updated,
          reservation: currentReservation,
          newAvailable: nextAvailable,
        };
      },
    );

    // Publish events setelah transaksi commit
    await this.eventBus.publish(
      EVENT_NAMES.StockDeducted,
      new StockDeductedEvent(
        reservation.materialId,
        warehouseId,
        reservation.qty,
        'reservation',
        reservation.id,
      ),
    );

    // Check low stock — sertakan nama material (Fase 8: payload lengkap
    // untuk alert Dashboard; materials milik Inventory Domain sendiri).
    const LIMIT = 5;
    if (newAvailable < LIMIT) {
      const material = await prisma.material.findUnique({
        where: { id: reservation.materialId },
        select: { nama: true },
      });
      await this.eventBus.publish(
        EVENT_NAMES.StockLow,
        new StockLowEvent(
          reservation.materialId,
          warehouseId,
          newAvailable,
          LIMIT,
          material?.nama ?? 'Material',
        ),
      );
    }

    return updatedReservation;
  }

  // ==========================================
  // Konsumsi Event (dipanggil oleh InventoryEventsProcessor)
  // ==========================================

  /**
   * Konsumen OrderConfirmed (§7.2): kunci reservasi jadi pengurangan
   * stok permanen (deduction) untuk semua reservasi ACTIVE milik order.
   *
   * IDEMPOTEN (§16): hanya reservasi ACTIVE yang diproses — event yang
   * dikirim dua kali tidak menghasilkan deduction ganda karena reservasi
   * sudah berstatus CONSUMED pada pemrosesan kedua.
   */
  async consumeReservationsForOrder(orderId: string): Promise<number> {
    const reservations = await prisma.stockReservation.findMany({
      where: { orderId, status: 'ACTIVE' },
    });

    if (reservations.length === 0) {
      this.logger.log(`No ACTIVE reservations for order ${orderId} — idempotent no-op`);
      return 0;
    }

    for (const res of reservations) {
      try {
        await this.deductStock(res.id);
      } catch (error) {
        this.logger.error(`Failed to deduct reservation ${res.id}: ${error}`);
        throw error; // biar BullMQ retry
      }
    }

    this.logger.log(`Consumed ${reservations.length} reservations for order ${orderId}`);
    return reservations.length;
  }

  /**
   * Konsumen PaymentFailed / PaymentExpired (§7.1): lepas semua
   * reservasi ACTIVE milik order.
   *
   * IDEMPOTEN: hanya reservasi ACTIVE yang dilepas.
   */
  async releaseReservationsForOrder(orderId: string): Promise<number> {
    const reservations = await prisma.stockReservation.findMany({
      where: { orderId, status: 'ACTIVE' },
    });

    if (reservations.length === 0) {
      this.logger.log(`No ACTIVE reservations for order ${orderId} — idempotent no-op`);
      return 0;
    }

    for (const res of reservations) {
      try {
        await this.releaseStock({ reservationId: res.id });
      } catch (error) {
        this.logger.error(`Failed to release reservation ${res.id}: ${error}`);
        throw error; // biar BullMQ retry
      }
    }

    this.logger.log(`Released ${reservations.length} reservations for order ${orderId}`);
    return reservations.length;
  }

  // ==========================================
  // Stock Movements & Aggregates
  // ==========================================

  async createStockMovement(dto: CreateStockMovementDto) {
    const { materialId, warehouseId, tipe, qty, refType, refId, createdBy } = dto;

    const { movement, newAvailable } = await prisma.$transaction(async (tx) => {
      // Lock row
      const balanceExists = await tx.stockBalance.findUnique({
        where: {
          materialId_warehouseId: { materialId, warehouseId },
        },
      });

      if (!balanceExists) {
        await tx.stockBalance.create({
          data: {
            materialId,
            warehouseId,
            qtyAvailable: 0,
            qtyReserved: 0,
          },
        });
      }

      const balances = await tx.$queryRaw<any[]>`
        SELECT * FROM "stock_balances"
        WHERE "material_id" = ${materialId} AND "warehouse_id" = ${warehouseId}
        FOR UPDATE
      `;
      const balance = balances[0];
      const available = Number(balance.qty_available ?? balance.qtyAvailable ?? 0);
      const reserved = Number(balance.qty_reserved ?? balance.qtyReserved ?? 0);

      let nextAvailable = available;
      let nextReserved = reserved;

      if (tipe === 'IN') {
        nextAvailable += qty;
      } else if (tipe === 'OUT') {
        if (available < qty) {
          throw new BadRequestException(
            `Stok tidak mencukupi untuk pengeluaran. Tersedia: ${available}, Diminta: ${qty}`,
          );
        }
        nextAvailable -= qty;
      } else if (tipe === 'RESERVE') {
        if (available - reserved < qty) {
          throw new BadRequestException(
            `Stok tidak mencukupi untuk reservasi. Tersedia: ${available - reserved}, Diminta: ${qty}`,
          );
        }
        nextReserved += qty;
      } else if (tipe === 'RELEASE') {
        nextReserved = Math.max(0, reserved - qty);
      } else if (tipe === 'ADJUST') {
        nextAvailable += qty;
        if (nextAvailable < 0) {
          throw new BadRequestException(
            `Penyesuaian stok akan mengakibatkan saldo negatif: ${nextAvailable}`,
          );
        }
      }

      // Write movement
      const newMovement = await tx.stockMovement.create({
        data: {
          materialId,
          warehouseId,
          tipe,
          qty,
          refType: refType ?? null,
          refId: refId ?? null,
          createdBy: createdBy ?? null,
        },
      });

      // Update balance
      await tx.stockBalance.update({
        where: {
          materialId_warehouseId: { materialId, warehouseId },
        },
        data: {
          qtyAvailable: nextAvailable,
          qtyReserved: nextReserved,
        },
      });

      return { movement: newMovement, newAvailable: nextAvailable };
    });

    // Publish events setelah transaksi commit
    if (tipe === 'OUT') {
      await this.eventBus.publish(
        EVENT_NAMES.StockDeducted,
        new StockDeductedEvent(materialId, warehouseId, qty, refType ?? null, refId ?? null),
      );

      const LIMIT = 5;
      if (newAvailable < LIMIT) {
        // Fase 8: payload lengkap — sertakan nama material untuk alert Dashboard
        const material = await prisma.material.findUnique({
          where: { id: materialId },
          select: { nama: true },
        });
        await this.eventBus.publish(
          EVENT_NAMES.StockLow,
          new StockLowEvent(
            materialId,
            warehouseId,
            newAvailable,
            LIMIT,
            material?.nama ?? 'Material',
          ),
        );
      }
    }

    return movement;
  }

  // ==========================================
  // Purchase Orders & Adjustments
  // ==========================================

  async createPurchaseOrder(dto: CreatePurchaseOrderDto) {
    const material = await prisma.material.findUnique({
      where: { id: dto.materialId },
    });
    if (!material) {
      throw new NotFoundException('Material tidak ditemukan');
    }

    return prisma.purchaseOrder.create({
      data: {
        supplier: dto.supplier,
        materialId: dto.materialId,
        qty: dto.qty,
        totalBiaya: dto.totalBiaya,
        tglBeli: new Date(dto.tglBeli),
        status: 'PENDING',
      },
    });
  }

  async findPurchaseOrders() {
    return prisma.purchaseOrder.findMany({
      include: { material: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Tandai PO diterima (PENDING → COMPLETED) — Fase 9 Bagian 2.
   *
   * BUKAN sekadar update status: barang yang diterima harus benar-benar
   * menambah stok. Dalam SATU transaksi: stock_movements tipe IN dicatat
   * (sumber kebenaran) + stock_balances.qty_available bertambah (cache),
   * pola row-lock yang sama dengan createStockMovement.
   */
  async completePurchaseOrder(purchaseOrderId: string, actorId?: string) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
    });
    if (!po) {
      throw new NotFoundException('Purchase order tidak ditemukan');
    }

    const warehouse = await prisma.warehouse.findFirst();
    if (!warehouse) {
      throw new NotFoundException('Gudang default tidak ditemukan');
    }
    const warehouseId = warehouse.id;

    return prisma.$transaction(async (tx) => {
      // Compare-and-swap: hanya satu request yang bisa memindahkan
      // PENDING → COMPLETED — klik ganda / request paralel tidak boleh
      // menambah stok dua kali.
      const swapped = await tx.purchaseOrder.updateMany({
        where: { id: purchaseOrderId, status: 'PENDING' },
        data: { status: 'COMPLETED' },
      });
      if (swapped.count === 0) {
        throw new BadRequestException('Purchase order sudah ditandai diterima');
      }

      // Pastikan record stock_balances ada sebelum di-lock
      const balanceExists = await tx.stockBalance.findUnique({
        where: {
          materialId_warehouseId: { materialId: po.materialId, warehouseId },
        },
      });

      if (!balanceExists) {
        await tx.stockBalance.create({
          data: {
            materialId: po.materialId,
            warehouseId,
            qtyAvailable: 0,
            qtyReserved: 0,
          },
        });
      }

      // Lock row menggunakan SELECT ... FOR UPDATE
      const balances = await tx.$queryRaw<any[]>`
        SELECT * FROM "stock_balances"
        WHERE "material_id" = ${po.materialId} AND "warehouse_id" = ${warehouseId}
        FOR UPDATE
      `;
      const balance = balances[0];
      const available = Number(balance.qty_available ?? balance.qtyAvailable ?? 0);

      // Catat movement IN (sumber kebenaran)
      await tx.stockMovement.create({
        data: {
          materialId: po.materialId,
          warehouseId,
          tipe: 'IN',
          qty: po.qty,
          refType: 'purchase_order',
          refId: po.id,
          createdBy: actorId ?? null,
        },
      });

      // Update balance cache
      await tx.stockBalance.update({
        where: {
          materialId_warehouseId: { materialId: po.materialId, warehouseId },
        },
        data: {
          qtyAvailable: available + po.qty,
        },
      });

      return tx.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: { material: true },
      });
    });
  }

  async findStockAdjustments() {
    return prisma.stockAdjustment.findMany({
      include: { material: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createStockAdjustment(dto: CreateStockAdjustmentDto) {
    const { materialId, qtyDelta, alasan, approvedBy } = dto;

    const warehouse = await prisma.warehouse.findFirst();
    if (!warehouse) {
      throw new NotFoundException('Gudang default tidak ditemukan');
    }
    const warehouseId = warehouse.id;

    return prisma.$transaction(async (tx) => {
      // 1. Buat stock adjustment
      const adjustment = await tx.stockAdjustment.create({
        data: {
          materialId,
          qtyDelta,
          alasan,
          approvedBy: approvedBy ?? null,
        },
      });

      // 2. Buat stock movement (tipe: ADJUST) dan update balance
      const balanceExists = await tx.stockBalance.findUnique({
        where: {
          materialId_warehouseId: { materialId, warehouseId },
        },
      });

      if (!balanceExists) {
        await tx.stockBalance.create({
          data: {
            materialId,
            warehouseId,
            qtyAvailable: 0,
            qtyReserved: 0,
          },
        });
      }

      const balances = await tx.$queryRaw<any[]>`
        SELECT * FROM "stock_balances"
        WHERE "material_id" = ${materialId} AND "warehouse_id" = ${warehouseId}
        FOR UPDATE
      `;
      const balance = balances[0];
      const available = Number(balance.qty_available ?? balance.qtyAvailable ?? 0);

      const newAvailable = available + qtyDelta;
      if (newAvailable < 0) {
        throw new BadRequestException(
          `Penyesuaian stok akan mengakibatkan saldo negatif: ${newAvailable}`,
        );
      }

      await tx.stockMovement.create({
        data: {
          materialId,
          warehouseId,
          tipe: 'ADJUST',
          qty: Math.abs(qtyDelta),
          refType: 'adjustment',
          refId: adjustment.id,
          createdBy: approvedBy ?? null,
        },
      });

      await tx.stockBalance.update({
        where: {
          materialId_warehouseId: { materialId, warehouseId },
        },
        data: {
          qtyAvailable: newAvailable,
        },
      });

      return adjustment;
    });
  }

  /**
   * Cek ketersediaan stok real-time berdasarkan BOM dan qty pesanan.
   * Dipanggil internal dari Order Domain (§15).
   */
  async checkAvailability(
    productType: string,
    qty: number,
  ): Promise<{ available: boolean; estimation?: string }> {
    const warehouse = await prisma.warehouse.findFirst();
    if (!warehouse) {
      return { available: false, estimation: 'Gudang default tidak ditemukan' };
    }
    const warehouseId = warehouse.id;

    let boms;
    try {
      boms = await this.getBom(productType);
    } catch (e: any) {
      return {
        available: false,
        estimation: `BOM untuk tipe produk "${productType}" belum dikonfigurasi`,
      };
    }

    const missingMaterials: string[] = [];

    for (const bomItem of boms) {
      const balance = await prisma.stockBalance.findUnique({
        where: {
          materialId_warehouseId: { materialId: bomItem.materialId, warehouseId },
        },
      });

      const qtyAvailable = Number(balance?.qtyAvailable ?? 0);
      const qtyReserved = Number(balance?.qtyReserved ?? 0);
      const freeStock = qtyAvailable - qtyReserved;
      const requiredStock = bomItem.qtyPerUnit * qty;

      if (freeStock < requiredStock) {
        missingMaterials.push(bomItem.material.nama);
      }
    }

    if (missingMaterials.length > 0) {
      return {
        available: false,
        estimation: `Bahan tidak mencukupi: ${missingMaterials.join(', ')}`,
      };
    }

    return {
      available: true,
      estimation: 'Bahan baku tersedia',
    };
  }

  // ==========================================
  // AI Inventory Prediction Context (Fase 12 Bagian 3)
  // ==========================================

  /**
   * Kumpulkan konteks inventory lengkap untuk AI Inventory Prediction.
   *
   * Data dikumpulkan dari tabel milik Inventory Domain (stock_balances,
   * stock_movements, bill_of_materials, materials). Untuk tren volume
   * pesanan, caller (AiAssistantService) akan memanggil OrderService
   * getOrderVolumeTrends() secara terpisah — InventoryService TIDAK
   * query tabel orders langsung (DDD §4.1).
   *
   * @param orderVolumeTrends — data tren volume dari OrderService
   */
  async getInventoryContextForAi(
    orderVolumeTrends?: Array<{
      period: string;
      orderCount: number;
      itemsByProductType: Record<string, number>;
    }>,
  ): Promise<{
    stockBalances: Array<{
      materialNama: string;
      materialId: string;
      satuan: string;
      qtyAvailable: number;
      qtyReserved: number;
      freeStock: number;
    }>;
    usageTrends: Array<{
      materialNama: string;
      materialId: string;
      totalUsed: number;
      periodeHari: number;
      avgPerDay: number;
    }>;
    activeOrderCount: number;
    bomSummary: Array<{
      productType: string;
      materials: Array<{ materialNama: string; qtyPerUnit: number; satuan: string }>;
    }>;
  }> {
    const PERIODE_HARI = 30;

    // 1. Stock balances (tabel milik Inventory Domain)
    const balances = await prisma.stockBalance.findMany({
      include: {
        material: { select: { id: true, nama: true, satuan: true } },
      },
    });

    const stockBalances = balances.map((b) => ({
      materialNama: b.material.nama,
      materialId: b.materialId,
      satuan: b.material.satuan,
      qtyAvailable: Number(b.qtyAvailable),
      qtyReserved: Number(b.qtyReserved),
      freeStock: Number(b.qtyAvailable) - Number(b.qtyReserved),
    }));

    // 2. Usage trends dari stock_movements OUT (tabel milik Inventory Domain)
    const since = new Date(Date.now() - PERIODE_HARI * 24 * 60 * 60 * 1000);
    const outMovements = await prisma.stockMovement.groupBy({
      by: ['materialId'],
      where: {
        tipe: 'OUT',
        createdAt: { gte: since },
      },
      _sum: { qty: true },
    });

    const materialIds = outMovements.map((m) => m.materialId);
    const materials =
      materialIds.length > 0
        ? await prisma.material.findMany({
            where: { id: { in: materialIds } },
            select: { id: true, nama: true },
          })
        : [];
    const materialMap = new Map(materials.map((m) => [m.id, m.nama]));

    const usageTrends = outMovements.map((m) => {
      const totalUsed = Number(m._sum.qty ?? 0);
      return {
        materialNama: materialMap.get(m.materialId) ?? 'Unknown',
        materialId: m.materialId,
        totalUsed,
        periodeHari: PERIODE_HARI,
        avgPerDay: totalUsed / PERIODE_HARI,
      };
    });

    // 3. Active order count dari order volume trends (dari caller via OrderService)
    const activeOrderCount = orderVolumeTrends?.reduce((sum, t) => sum + t.orderCount, 0) ?? 0;

    // 4. BOM summary (tabel milik Inventory Domain)
    const boms = await prisma.billOfMaterial.findMany({
      include: {
        material: { select: { nama: true, satuan: true } },
      },
      orderBy: [{ productType: 'asc' }],
    });

    const bomByProduct = new Map<
      string,
      Array<{ materialNama: string; qtyPerUnit: number; satuan: string }>
    >();
    for (const bom of boms) {
      if (!bomByProduct.has(bom.productType)) {
        bomByProduct.set(bom.productType, []);
      }
      bomByProduct.get(bom.productType)!.push({
        materialNama: bom.material.nama,
        qtyPerUnit: Number(bom.qtyPerUnit),
        satuan: bom.material.satuan,
      });
    }

    const bomSummary = Array.from(bomByProduct.entries()).map(([productType, materials]) => ({
      productType,
      materials,
    }));

    return {
      stockBalances,
      usageTrends,
      activeOrderCount,
      bomSummary,
    };
  }

  // ==========================================
  // Analytics Internal Methods (Fase 13)
  // ==========================================

  /**
   * Stock accuracy: 1 - (rasiadjustment terhadap total movement).
   * Formula: accuracy = 1 - (COUNT(ADJUST) / COUNT(IN+OUT+ADJUST))
   * Semakin rendah rasio adjustment, semakin akurat stok.
   *
   * PLACEHOLDER: Karena tidak ada physical stock count, akurasi diukur
   * dari seberapa jarang koreksi manual terjadi.
   *
   * Dipanggil oleh AnalyticsService (DDD boundary).
   */
  async getStockAccuracy(
    from: Date,
    to: Date,
  ): Promise<{ totalMovements: number; adjustments: number; accuracy: number }> {
    const movements = await prisma.stockMovement.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        tipe: { in: ['IN', 'OUT', 'ADJUST'] },
      },
      select: { tipe: true },
    });

    const totalMovements = movements.length;
    const adjustments = movements.filter((m) => m.tipe === 'ADJUST').length;
    const accuracy = totalMovements > 0 ? 1 - adjustments / totalMovements : 1;

    return { totalMovements, adjustments, accuracy };
  }
}
