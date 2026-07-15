import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { prisma } from '@mlv/db';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { OrderService } from '../../order/services/order.service';
import { EVENT_NAMES } from '@mlv/types';
import { ShipmentStatus } from '@mlv/db';
import {
  CreateShipmentDto,
  UpdateShipmentDto,
  CreateShipmentResponseDto,
  PublicTrackingResponseDto,
} from '../dto/shipping.dto';
import { ShipmentCreatedEvent, ShipmentDeliveredEvent } from '../events/shipping.events';

/**
 * Shipping Domain Service
 *
 * Responsibility: Kurir, resi, dan status pengiriman.
 *
 * DDD Boundary (§4.1):
 * - Membaca data Order: lewat OrderService (bukan query langsung ke tabel Order)
 * - Transisi status Order: lewat event (ShipmentCreated → Order Events Processor)
 * - Update status Shipping: langsung di sini
 */
@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    private readonly eventBus: EventBusService,
    private readonly orderService: OrderService,
  ) {}

  // ==========================================
  // Shipment CRUD
  // ==========================================

  /**
   * POST /shipments — Buat shipment baru.
   *
   * Gate: Tolak jika order.status belum LUNAS.
   * Validasi lewat OrderService (DDD boundary).
   */
  async createShipment(dto: CreateShipmentDto): Promise<CreateShipmentResponseDto> {
    // 1. Validasi order ada dan status LUNAS (via OrderService — DDD boundary)
    const order = await this.orderService.getOrderByIdInternal(dto.orderId);

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    if (order.status !== 'LUNAS') {
      throw new BadRequestException(
        `Order belum berstatus LUNAS. Status saat ini: ${order.status}. ` +
          'Shipment hanya bisa dibuat setelah pembayaran lunas.',
      );
    }

    // 2. Cek apakah sudah ada shipment untuk order ini
    const existingShipment = await prisma.shipment.findUnique({
      where: { orderId: dto.orderId },
    });

    if (existingShipment) {
      throw new BadRequestException('Shipment untuk order ini sudah ada');
    }

    // 3. Buat shipment
    const shipment = await prisma.shipment.create({
      data: {
        orderId: dto.orderId,
        kurir: dto.kurir,
        noResi: dto.noResi ?? null,
        status: dto.noResi ? 'DIKIRIM' : 'DICATAT',
        alamatPengiriman: dto.alamatPengiriman ?? order.alamat ?? null,
        biayaKirim: dto.biayaKirim ?? null,
        shippedAt: dto.noResi ? new Date() : null,
      },
    });

    // 4. Publish ShipmentCreated event
    //    - Order Events Processor akan konsumsi dan transisi order → DIKIRIM
    //    - Notification akan kirim notifikasi ke customer
    await this.eventBus.publish(
      EVENT_NAMES.ShipmentCreated,
      new ShipmentCreatedEvent(
        shipment.id,
        shipment.orderId,
        order.orderNumber,
        shipment.kurir,
        shipment.trackingToken,
        shipment.createdAt,
      ),
    );

    this.logger.log(
      `Shipment ${shipment.id} dibuat untuk order ${order.orderNumber} (${shipment.kurir})`,
    );

    return this.mapToResponse(shipment);
  }

  /**
   * PATCH /shipments/:id — Update shipment.
   */
  async updateShipment(id: string, dto: UpdateShipmentDto): Promise<CreateShipmentResponseDto> {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
    });

    if (!shipment) {
      throw new NotFoundException('Shipment tidak ditemukan');
    }

    // Track status changes for publishing events
    const previousStatus = shipment.status;

    // Update fields
    const updated = await prisma.shipment.update({
      where: { id },
      data: {
        ...(dto.noResi !== undefined && { noResi: dto.noResi }),
        ...(dto.kurir !== undefined && { kurir: dto.kurir }),
        ...(dto.biayaKirim !== undefined && { biayaKirim: dto.biayaKirim }),
        ...(dto.alamatPengiriman !== undefined && { alamatPengiriman: dto.alamatPengiriman }),
        ...(dto.status !== undefined && { status: dto.status }),
        // Auto-set shippedAt when status transitions to DIKIRIM
        ...(dto.status === 'DIKIRIM' && !shipment.shippedAt && { shippedAt: new Date() }),
        // Auto-set deliveredAt when status transitions to DITERIMA
        ...(dto.status === 'DITERIMA' && !shipment.deliveredAt && { deliveredAt: new Date() }),
      },
    });

    // Publish events for status transitions
    if (dto.status === 'DITERIMA' && previousStatus !== 'DITERIMA') {
      const order = await prisma.order.findUnique({
        where: { id: shipment.orderId },
      });

      if (order) {
        await this.eventBus.publish(
          EVENT_NAMES.ShipmentDelivered,
          new ShipmentDeliveredEvent(shipment.id, shipment.orderId, order.orderNumber, new Date()),
        );
      }
    }

    this.logger.log(`Shipment ${id} diupdate: ${previousStatus} → ${updated.status}`);

    return this.mapToResponse(updated);
  }

  /**
   * GET /shipments — Daftar shipment (staff only).
   */
  async findShipments(): Promise<CreateShipmentResponseDto[]> {
    const shipments = await prisma.shipment.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return shipments.map((s) => this.mapToResponse(s));
  }

  /**
   * GET /shipments/:id — Detail shipment.
   */
  async getShipmentById(id: string): Promise<CreateShipmentResponseDto> {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
    });

    if (!shipment) {
      throw new NotFoundException('Shipment tidak ditemukan');
    }

    return this.mapToResponse(shipment);
  }

  // ==========================================
  // Public Tracking (§8)
  // ==========================================

  /**
   * GET /shipments/track/:token — Tracking publik via token unik.
   * Tidak memerlukan auth. Hanya return info minimal (tidak sensitif).
   */
  async publicTracking(token: string): Promise<PublicTrackingResponseDto> {
    const shipment = await prisma.shipment.findUnique({
      where: { trackingToken: token },
      include: {
        order: {
          select: {
            orderNumber: true,
          },
        },
      },
    });

    if (!shipment) {
      throw new NotFoundException('Tracking tidak ditemukan');
    }

    // Return minimal public info — no prices, no customer data
    return {
      orderNumber: shipment.order.orderNumber,
      status: this.getPublicStatusLabel(shipment.status),
      kurir: shipment.kurir,
      noResi: shipment.noResi,
      shippedAt: shipment.shippedAt,
      deliveredAt: shipment.deliveredAt,
      lastUpdate: shipment.updatedAt,
    };
  }

  /**
   * GET /shipments/order/:orderId/track — Alias untuk public tracking via orderId.
   * Ini endpoint publik yang disebut di §8 PRD.
   * Digunakan untuk customer tracking page (bukan implementasi web, hanya API contract).
   */
  async publicTrackingByOrderId(orderId: string): Promise<PublicTrackingResponseDto> {
    const shipment = await prisma.shipment.findUnique({
      where: { orderId },
      include: {
        order: {
          select: {
            orderNumber: true,
          },
        },
      },
    });

    if (!shipment) {
      throw new NotFoundException('Tracking tidak ditemukan untuk order ini');
    }

    return {
      orderNumber: shipment.order.orderNumber,
      status: this.getPublicStatusLabel(shipment.status),
      kurir: shipment.kurir,
      noResi: shipment.noResi,
      shippedAt: shipment.shippedAt,
      deliveredAt: shipment.deliveredAt,
      lastUpdate: shipment.updatedAt,
    };
  }

  // ==========================================
  // Helpers
  // ==========================================

  /**
   * Map Prisma Shipment to response DTO.
   */
  private mapToResponse(shipment: {
    id: string;
    orderId: string;
    kurir: string;
    noResi: string | null;
    status: ShipmentStatus;
    alamatPengiriman: string | null;
    biayaKirim: number | null;
    trackingToken: string;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): CreateShipmentResponseDto {
    return {
      id: shipment.id,
      orderId: shipment.orderId,
      kurir: shipment.kurir,
      noResi: shipment.noResi,
      status: shipment.status,
      alamatPengiriman: shipment.alamatPengiriman,
      biayaKirim: shipment.biayaKirim,
      trackingToken: shipment.trackingToken,
      shippedAt: shipment.shippedAt,
      deliveredAt: shipment.deliveredAt,
      createdAt: shipment.createdAt,
      updatedAt: shipment.updatedAt,
    };
  }

  /**
   * Get human-readable status label for public tracking.
   */
  private getPublicStatusLabel(status: ShipmentStatus): string {
    switch (status) {
      case 'DICATAT':
        return 'Siap Dikirim';
      case 'DIKIRIM':
        return 'Dalam Pengiriman';
      case 'DALAM_TRANSIT':
        return 'Sedang Transit';
      case 'DITERIMA':
        return 'Sudah Diterima';
      default:
        return status;
    }
  }
}
