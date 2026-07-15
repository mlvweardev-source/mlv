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
        : new Date(Date.now() + 15 * 60 * 1000); // 15 menit default
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
}
