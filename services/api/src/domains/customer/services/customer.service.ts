import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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

    const review = await prisma.review.create({
      data: {
        customerId: id,
        rating: dto.rating,
        komentar: dto.komentar,
        orderId: dto.orderId ?? null,
      },
    });

    return review;
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
}
