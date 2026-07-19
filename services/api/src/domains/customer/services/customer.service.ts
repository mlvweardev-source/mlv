import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { prisma } from '@mlv/db';
import { ActorType } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { EVENT_NAMES } from '@mlv/types';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { UpdateCustomerDto, CreateReviewDto } from '../dto/customer.dto';
import { CustomerProfileUpdatedEvent } from '../events/customer.events';

@Injectable()
export class CustomerService {
  constructor(private readonly eventBus: EventBusService) {}

  /**
   * GET /customers/:id — Ambil profil pelanggan.
   * Pelanggan hanya bisa lihat profil sendiri, staff bisa lihat semua.
   */
  async findOne(id: string, actor: JwtPayload) {
    this.ensureCustomerAccess(id, actor);

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        authMethods: {
          select: { id: true, tipe: true, createdAt: true },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Pelanggan tidak ditemukan');
    }

    return customer;
  }

  /**
   * PATCH /customers/:id — Update profil pelanggan.
   * Pelanggan hanya bisa update profilnya sendiri, Owner bisa update semua.
   */
  async update(id: string, dto: UpdateCustomerDto, actor: JwtPayload) {
    this.ensureCustomerAccess(id, actor);

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Pelanggan tidak ditemukan');
    }

    const updatedFields: string[] = [];
    if (dto.nama !== undefined) updatedFields.push('nama');
    if (dto.alamat !== undefined) updatedFields.push('alamat');
    if (dto.email !== undefined) updatedFields.push('email');

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        ...(dto.nama !== undefined && { nama: dto.nama }),
        ...(dto.alamat !== undefined && { alamat: dto.alamat }),
        ...(dto.email !== undefined && { email: dto.email }),
      },
    });

    // Publish event (§4 — DDD)
    await this.eventBus.publish(
      EVENT_NAMES.CustomerProfileUpdated,
      new CustomerProfileUpdatedEvent(customer.id, updatedFields, new Date()),
    );

    return customer;
  }

  /**
   * GET /customers/:id/orders — Ambil daftar order pelanggan.
   */
  async findOrders(id: string, actor: JwtPayload) {
    this.ensureCustomerAccess(id, actor);

    // Verifikasi customer ada
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException('Pelanggan tidak ditemukan');
    }

    // Query Order Domain
    const orders = await prisma.order.findMany({
      where: { customerId: id },
      include: {
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      customerId: id,
      customerNama: customer.nama,
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        deadline: o.deadline,
        createdAt: o.createdAt,
        itemCount: o._count.items,
      })),
      totalOrders: orders.length,
    };
  }

  /**
   * POST /customers/:id/reviews — Buat review.
   * Hanya pelanggan yang bersangkutan yang bisa buat review.
   */
  async createReview(id: string, dto: CreateReviewDto, actor: JwtPayload) {
    // Review hanya bisa dibuat oleh customer sendiri
    if (actor.actorType !== ActorType.CUSTOMER || actor.sub !== id) {
      throw new ForbiddenException('Anda hanya bisa membuat review untuk akun Anda sendiri');
    }

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new NotFoundException('Pelanggan tidak ditemukan');
    }

    const order = await prisma.order.findUnique({ where: { id: dto.orderId } });
    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }
    if (order.customerId !== id) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }
    if (order.status !== 'DIKIRIM') {
      throw new BadRequestException(
        `Review hanya dapat diberikan setelah order berstatus DIKIRIM (status saat ini: ${order.status})`,
      );
    }

    const existingReview = await prisma.review.findFirst({
      where: { customerId: id, orderId: dto.orderId },
    });
    if (existingReview) {
      throw new ConflictException('Review untuk order ini sudah pernah diberikan');
    }

    const review = await prisma.review.create({
      data: {
        customerId: id,
        rating: dto.rating,
        komentar: dto.komentar,
        orderId: dto.orderId,
      },
    });

    return review;
  }

  // ==========================================
  // Cross-Domain: Get Customer Data (DDD Boundary §4.1)
  // ==========================================
  // Domain lain (Order, Finance, Production, Shipping) memanggil method
  // ini untuk mengambil identitas/kontak pelanggan SEBELUM publish event —
  // payload event harus lengkap agar Notification (proses terpisah) tidak
  // perlu memanggil balik service domain lain (prinsip Fase 8).
  // Domain lain TIDAK BOLEH query prisma.customer.findUnique() langsung.

  /**
   * Ambil data customer minimal untuk kebutuhan payload event / validasi
   * domain lain. Mengembalikan data internal, BUKAN DTO response.
   *
   * @param customerId - ID customer
   * @returns { id, nama, noHp, email } atau null jika tidak ada
   */
  async getCustomerByIdInternal(customerId: string): Promise<{
    id: string;
    nama: string;
    noHp: string | null;
    email: string | null;
  } | null> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, nama: true, noHp: true, email: true },
    });

    return customer;
  }

  /**
   * Ambil data banyak customer sekaligus (internal use only, batch).
   *
   * Dipakai CustomerChatService untuk resolve banyak nama pengirim sekaligus
   * (anti N+1) — pola sama dengan `getUsersByIdsInternal` di AuthService.
   *
   * DDD §4.1: Caller TIDAK BOLEH query `prisma.customer.findMany` sendiri.
   *
   * @returns Map keyed by customerId; customer yang tidak ada di-skip
   */
  async getCustomersByIdsInternal(
    customerIds: string[],
  ): Promise<Map<string, { id: string; nama: string }>> {
    if (customerIds.length === 0) return new Map();

    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, nama: true },
    });

    return new Map(customers.map((c) => [c.id, { id: c.id, nama: c.nama }]));
  }

  // =====================
  // Access Control Helper
  // =====================

  private ensureCustomerAccess(customerId: string, actor: JwtPayload) {
    // Pelanggan hanya bisa akses data sendiri
    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke data pelanggan lain');
    }
    // Staff (semua role) bisa akses data customer manapun
  }

  // ==========================================
  // Analytics Internal Methods (Fase 13)
  // ==========================================

  /**
   * Repeat customer rate: % customer dengan >1 order dalam periode.
   * Dipanggil oleh AnalyticsService (DDD boundary).
   */
  async getRepeatCustomerRate(
    from: Date,
    to: Date,
  ): Promise<{ totalActive: number; repeatCount: number; rate: number }> {
    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { notIn: ['DRAFT', 'DIBATALKAN'] },
      },
      select: { customerId: true },
    });

    const orderCountByCustomer = new Map<string, number>();
    for (const o of orders) {
      orderCountByCustomer.set(o.customerId, (orderCountByCustomer.get(o.customerId) ?? 0) + 1);
    }

    const totalActive = orderCountByCustomer.size;
    const repeatCount = Array.from(orderCountByCustomer.values()).filter(
      (count) => count > 1,
    ).length;
    const rate = totalActive > 0 ? repeatCount / totalActive : 0;

    return { totalActive, repeatCount, rate };
  }
}
