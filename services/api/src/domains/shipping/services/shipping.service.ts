import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { prisma } from '@mlv/db';
import type { ShipmentStatus } from '@mlv/db';
import { EVENT_NAMES } from '@mlv/types';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { OrderService } from '../../order/services/order.service';
import { CustomerService } from '../../customer/services/customer.service';
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
 * Responsibility: Kurir, resi, dan status pengiriman (§4).
 * Resi MANUAL — staff input nama kurir + no resi setelah barang
 * diserahkan fisik ke kurir. BUKAN integrasi API kurir riil.
 *
 * DDD Boundary (§4.1):
 * - Baca data Order (status, orderNumber, alamat customer): HANYA lewat
 *   OrderService.getOrderByIdInternal() — tidak ada query ke tabel
 *   orders/customers dari sini.
 * - Transisi status Order → DIKIRIM: lewat event ShipmentCreated
 *   (BullMQ → OrderEventsProcessor), bukan panggilan langsung.
 * - biaya_kirim INFORMASIONAL saja — TIDAK diintegrasikan ke
 *   Finance/invoice (di luar scope, closed di Fase 5).
 */
@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    private readonly eventBus: EventBusService,
    private readonly activityLog: ActivityLogService,
    private readonly orderService: OrderService,
    private readonly customerService: CustomerService,
  ) {}

  // ==========================================
  // Shipment CRUD (staff)
  // ==========================================

  /**
   * POST /shipments — Buat shipment baru.
   *
   * GATE: tolak jika order.status belum LUNAS — validasi lewat
   * OrderService (DDD boundary), bukan baca tabel Order langsung.
   * Alamat default dari customers.alamat (via OrderService), bisa
   * di-override lewat dto.alamatPengiriman.
   */
  async createShipment(dto: CreateShipmentDto): Promise<CreateShipmentResponseDto> {
    // 1. Validasi order ada + status LUNAS (via OrderService — DDD boundary)
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

    // 2. Satu shipment per order
    const existingShipment = await prisma.shipment.findUnique({
      where: { orderId: dto.orderId },
    });

    if (existingShipment) {
      throw new BadRequestException('Shipment untuk order ini sudah ada');
    }

    // 3. Buat shipment — trackingToken di-generate otomatis (uuid, kolom unique)
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

    // 4. Publish ShipmentCreated SETELAH commit (pola Fase 6):
    //    - order-events → OrderEventsProcessor transisi order → DIKIRIM
    //    - notification-events → subscriber umum
    //    Payload lengkap dengan kontak pelanggan + noResi (Fase 8) —
    //    Notification proses terpisah tidak memanggil balik domain lain.
    const customer = await this.customerService.getCustomerByIdInternal(order.customerId);
    await this.eventBus.publish(
      EVENT_NAMES.ShipmentCreated,
      new ShipmentCreatedEvent(
        shipment.id,
        shipment.orderId,
        order.orderNumber,
        shipment.kurir,
        shipment.trackingToken,
        shipment.createdAt,
        shipment.noResi,
        order.customerId,
        customer?.nama ?? 'Pelanggan',
        customer?.noHp ?? null,
      ),
    );

    this.logger.log(
      `Shipment ${shipment.id} dibuat untuk order ${order.orderNumber} (${shipment.kurir})`,
    );

    // Activity Log (§6.8): shipment dibuat = aksi penting
    await this.activityLog.log(
      null, // ShippingService tidak punya actor context — caller controller punya
      'SYSTEM', // shipping = aksi manual staff yang sudah gate LUNAS
      `Shipment untuk order ${order.orderNumber} dibuat via ${shipment.kurir}${shipment.noResi ? ` (resi: ${shipment.noResi})` : ''}`,
      'Shipment',
      shipment.id,
    );

    return this.mapToResponse(shipment);
  }

  /**
   * PATCH /shipments/:id — Update shipment (resi, kurir, status, dll).
   * Transisi status → DITERIMA menerbitkan ShipmentDelivered.
   */
  async updateShipment(id: string, dto: UpdateShipmentDto): Promise<CreateShipmentResponseDto> {
    const shipment = await prisma.shipment.findUnique({
      where: { id },
    });

    if (!shipment) {
      throw new NotFoundException('Shipment tidak ditemukan');
    }

    const previousStatus = shipment.status;

    const updated = await prisma.shipment.update({
      where: { id },
      data: {
        ...(dto.noResi !== undefined && { noResi: dto.noResi }),
        ...(dto.kurir !== undefined && { kurir: dto.kurir }),
        ...(dto.biayaKirim !== undefined && { biayaKirim: dto.biayaKirim }),
        ...(dto.alamatPengiriman !== undefined && { alamatPengiriman: dto.alamatPengiriman }),
        ...(dto.status !== undefined && { status: dto.status }),
        // Auto-set timestamp saat transisi status
        ...(dto.status === 'DIKIRIM' && !shipment.shippedAt && { shippedAt: new Date() }),
        ...(dto.status === 'DITERIMA' && !shipment.deliveredAt && { deliveredAt: new Date() }),
      },
    });

    // Publish ShipmentDelivered saat transisi → DITERIMA.
    // orderNumber diambil via OrderService (DDD boundary §4.1).
    if (dto.status === 'DITERIMA' && previousStatus !== 'DITERIMA') {
      const order = await this.orderService.getOrderByIdInternal(shipment.orderId);
      if (order) {
        await this.eventBus.publish(
          EVENT_NAMES.ShipmentDelivered,
          new ShipmentDeliveredEvent(shipment.id, shipment.orderId, order.orderNumber, new Date()),
        );

        // Activity Log (§6.8): shipment sampai
        await this.activityLog.log(
          null,
          'SYSTEM',
          `Shipment order ${order.orderNumber} ditandai DITERIMA`,
          'Shipment',
          shipment.id,
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
   * GET /shipments/:id — Detail shipment (staff only).
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
  // Cross-Domain: Internal Read Method (DDD Boundary §4.1)
  // ==========================================
  //
  // Beda dengan `getShipmentById(id)` (endpoint publik) — `getShipmentForOrder`
  // untuk dipanggil domain lain dalam SATU proses (services/api).
  //
  // DDD §4.1: Caller (mis. CustomerChatService untuk konteks AI auto-reply)
  // TIDAK BOLEH query `prisma.shipment.findFirst` sendiri — harus lewat sini.
  // 1 order = max 1 shipment (keputusan Fase 7, unique constraint).
  // Return null kalau belum ada shipment — caller bisa handle.

  /**
   * Ambil shipment untuk satu order (internal use only).
   *
   * Beda dengan `getShipmentById(shipmentId)`:
   * - getShipmentById → endpoint publik via /shipments/:id, lookup by id
   * - getShipmentForOrder → internal call antar service, lookup by orderId,
   *   return null (bukan throw) kalau belum ada shipment
   *
   * @returns Shipment milik order tsb, atau null kalau belum ada
   */
  async getShipmentForOrder(orderId: string): Promise<{
    id: string;
    kurir: string;
    noResi: string | null;
    status: string;
    shippedAt: Date | null;
    deliveredAt: Date | null;
  } | null> {
    const shipment = await prisma.shipment.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });

    if (!shipment) return null;

    return {
      id: shipment.id,
      kurir: shipment.kurir,
      noResi: shipment.noResi,
      status: shipment.status,
      shippedAt: shipment.shippedAt,
      deliveredAt: shipment.deliveredAt,
    };
  }

  // ==========================================
  // Public Tracking (§8 — via token unik)
  // ==========================================

  /**
   * GET /shipments/:token/track — Tracking publik via TOKEN UNIK.
   *
   * Keputusan Fase 7 #4: BUKAN via orderId polos yang bisa ditebak —
   * token acak (uuid) di-generate per shipment saat create.
   * Response hanya info minimal: TIDAK ada harga, alamat, atau data
   * pelanggan (ini endpoint publik tanpa auth).
   * Token salah → 404 tanpa membocorkan apakah order-nya ada.
   */
  async publicTracking(token: string): Promise<PublicTrackingResponseDto> {
    const shipment = await prisma.shipment.findUnique({
      where: { trackingToken: token },
    });

    if (!shipment) {
      throw new NotFoundException('Tracking tidak ditemukan');
    }

    // orderNumber via OrderService (DDD boundary §4.1)
    const order = await this.orderService.getOrderByIdInternal(shipment.orderId);

    return {
      orderNumber: order?.orderNumber ?? '-',
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
   * Map Prisma Shipment ke response DTO staff.
   * CATATAN: trackingToken disertakan di response staff (untuk
   * dibagikan ke pelanggan), TIDAK pernah muncul di response publik.
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
   * Label status human-readable untuk tracking publik.
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

  // ==========================================
  // Analytics Internal Methods (Fase 13)
  // ==========================================

  /**
   * On-time delivery rate: % pengiriman yang deliveredAt <= order.deadline.
   * Dipanggil oleh AnalyticsService (DDD boundary).
   */
  async getOnTimeDeliveryRate(
    from: Date,
    to: Date,
  ): Promise<{ total: number; onTime: number; rate: number }> {
    const shipments = await prisma.shipment.findMany({
      where: {
        deliveredAt: { not: null },
        shippedAt: { gte: from, lte: to },
      },
      select: {
        deliveredAt: true,
        order: { select: { deadline: true } },
      },
    });

    const total = shipments.length;
    if (total === 0) return { total: 0, onTime: 0, rate: 0 };

    const onTime = shipments.filter((s) => {
      if (!s.deliveredAt || !s.order.deadline) return false;
      return s.deliveredAt <= s.order.deadline;
    }).length;

    return { total, onTime, rate: onTime / total };
  }
}
