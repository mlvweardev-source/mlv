import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { prisma } from '@mlv/db';
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
  constructor(private readonly eventEmitter: EventEmitter2) {}

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

    return prisma.$transaction(async (tx) => {
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
      const reservation = await tx.stockReservation.create({
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
          refId: reservation.id,
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

      // 6. Emit event
      this.eventEmitter.emit(
        StockReservedEvent.eventName,
        new StockReservedEvent(
          reservation.id,
          reservation.orderId,
          reservation.materialId,
          reservation.qty,
          reservation.expiresAt,
        ),
      );

      return reservation;
    });
  }

  async releaseStock(dto: ReleaseStockDto) {
    const warehouse = await prisma.warehouse.findFirst();
    if (!warehouse) {
      throw new NotFoundException('Gudang default tidak ditemukan');
    }
    const warehouseId = warehouse.id;

    return prisma.$transaction(async (tx) => {
      const reservation = await tx.stockReservation.findUnique({
        where: { id: dto.reservationId },
      });

      if (!reservation) {
        throw new NotFoundException('Reservasi tidak ditemukan');
      }

      if (reservation.status !== 'ACTIVE') {
        throw new BadRequestException(
          `Reservasi sudah tidak aktif (status saat ini: ${reservation.status})`,
        );
      }

      // Lock row
      const balances = await tx.$queryRaw<any[]>`
        SELECT * FROM "stock_balances" 
        WHERE "material_id" = ${reservation.materialId} AND "warehouse_id" = ${warehouseId} 
        FOR UPDATE
      `;
      const balance = balances[0];
      if (!balance) {
        throw new NotFoundException('Saldo stok tidak ditemukan');
      }

      const reserved = Number(balance.qty_reserved ?? balance.qtyReserved ?? 0);

      // Update status
      const updatedReservation = await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { status: 'RELEASED' },
      });

      // Write movement
      await tx.stockMovement.create({
        data: {
          materialId: reservation.materialId,
          warehouseId,
          tipe: 'RELEASE',
          qty: reservation.qty,
          refType: 'reservation',
          refId: reservation.id,
        },
      });

      // Update balance
      await tx.stockBalance.update({
        where: {
          materialId_warehouseId: {
            materialId: reservation.materialId,
            warehouseId,
          },
        },
        data: {
          qtyReserved: Math.max(0, reserved - reservation.qty),
        },
      });

      // Emit event
      this.eventEmitter.emit(
        StockReservationReleasedEvent.eventName,
        new StockReservationReleasedEvent(
          reservation.id,
          reservation.orderId,
          reservation.materialId,
          reservation.qty,
        ),
      );

      return updatedReservation;
    });
  }

  async deductStock(reservationId: string) {
    const warehouse = await prisma.warehouse.findFirst();
    if (!warehouse) {
      throw new NotFoundException('Gudang default tidak ditemukan');
    }
    const warehouseId = warehouse.id;

    return prisma.$transaction(async (tx) => {
      const reservation = await tx.stockReservation.findUnique({
        where: { id: reservationId },
      });

      if (!reservation) {
        throw new NotFoundException('Reservasi tidak ditemukan');
      }

      if (reservation.status !== 'ACTIVE') {
        throw new BadRequestException(
          `Reservasi sudah tidak aktif (status saat ini: ${reservation.status})`,
        );
      }

      // Lock row
      const balances = await tx.$queryRaw<any[]>`
        SELECT * FROM "stock_balances" 
        WHERE "material_id" = ${reservation.materialId} AND "warehouse_id" = ${warehouseId} 
        FOR UPDATE
      `;
      const balance = balances[0];
      if (!balance) {
        throw new NotFoundException('Saldo stok tidak ditemukan');
      }

      const available = Number(balance.qty_available ?? balance.qtyAvailable ?? 0);
      const reserved = Number(balance.qty_reserved ?? balance.qtyReserved ?? 0);

      // Update status
      const updatedReservation = await tx.stockReservation.update({
        where: { id: reservationId },
        data: { status: 'CONSUMED' },
      });

      // Write movement (OUT)
      await tx.stockMovement.create({
        data: {
          materialId: reservation.materialId,
          warehouseId,
          tipe: 'OUT',
          qty: reservation.qty,
          refType: 'reservation',
          refId: reservation.id,
        },
      });

      // Update balance cache
      const newAvailable = Math.max(0, available - reservation.qty);
      const newReserved = Math.max(0, reserved - reservation.qty);

      await tx.stockBalance.update({
        where: {
          materialId_warehouseId: {
            materialId: reservation.materialId,
            warehouseId,
          },
        },
        data: {
          qtyAvailable: newAvailable,
          qtyReserved: newReserved,
        },
      });

      // Emit event
      this.eventEmitter.emit(
        StockDeductedEvent.eventName,
        new StockDeductedEvent(
          reservation.materialId,
          warehouseId,
          reservation.qty,
          'reservation',
          reservation.id,
        ),
      );

      // Check low stock
      const LIMIT = 5;
      if (newAvailable < LIMIT) {
        this.eventEmitter.emit(
          StockLowEvent.eventName,
          new StockLowEvent(reservation.materialId, warehouseId, newAvailable, LIMIT),
        );
      }

      return updatedReservation;
    });
  }

  // ==========================================
  // Stock Movements & Aggregates
  // ==========================================

  async createStockMovement(dto: CreateStockMovementDto) {
    const { materialId, warehouseId, tipe, qty, refType, refId, createdBy } = dto;

    return prisma.$transaction(async (tx) => {
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

      let newAvailable = available;
      let newReserved = reserved;

      if (tipe === 'IN') {
        newAvailable += qty;
      } else if (tipe === 'OUT') {
        if (available < qty) {
          throw new BadRequestException(
            `Stok tidak mencukupi untuk pengeluaran. Tersedia: ${available}, Diminta: ${qty}`,
          );
        }
        newAvailable -= qty;
      } else if (tipe === 'RESERVE') {
        if (available - reserved < qty) {
          throw new BadRequestException(
            `Stok tidak mencukupi untuk reservasi. Tersedia: ${available - reserved}, Diminta: ${qty}`,
          );
        }
        newReserved += qty;
      } else if (tipe === 'RELEASE') {
        newReserved = Math.max(0, reserved - qty);
      } else if (tipe === 'ADJUST') {
        newAvailable += qty;
        if (newAvailable < 0) {
          throw new BadRequestException(
            `Penyesuaian stok akan mengakibatkan saldo negatif: ${newAvailable}`,
          );
        }
      }

      // Write movement
      const movement = await tx.stockMovement.create({
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
          qtyAvailable: newAvailable,
          qtyReserved: newReserved,
        },
      });

      // Emit event
      if (tipe === 'OUT') {
        this.eventEmitter.emit(
          StockDeductedEvent.eventName,
          new StockDeductedEvent(materialId, warehouseId, qty, refType ?? null, refId ?? null),
        );

        const LIMIT = 5;
        if (newAvailable < LIMIT) {
          this.eventEmitter.emit(
            StockLowEvent.eventName,
            new StockLowEvent(materialId, warehouseId, newAvailable, LIMIT),
          );
        }
      }

      return movement;
    });
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
