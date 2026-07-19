import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { prisma } from '@mlv/db';
import type { JwtPayload } from '@mlv/auth';
import { ActorType, UserRole } from '@mlv/auth';
import { EVENT_NAMES } from '@mlv/types';
import { EventBusService } from '../../../event-bus/event-bus.service';
import {
  CreatePaymentDto,
  CreateApprovalDto,
  DecideApprovalDto,
  CreateProfitSharingDto,
  UpdateProfitSharingDto,
} from '../dto/finance.dto';
import {
  PaymentSucceededEvent,
  PaymentFailedEvent,
  PaymentExpiredEvent,
  InvoiceIssuedEvent,
  ApprovalRequestedEvent,
  ApprovalDecidedEvent,
} from '../events/finance.events';
import { OrderService } from '../../order/services/order.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { CustomerService } from '../../customer/services/customer.service';
import { AuthService } from '../../identity-access/services/auth.service';
import { ActivityLogService } from '../../../common/activity-log/activity-log.service';
import { InvoicePdfService } from './invoice-pdf.service';

// Midtrans Snap API types
interface MidtransSnapResponse {
  token: string;
  redirect_url: string;
}

/**
 * Finance Domain Service
 *
 * Responsibility: Payment, Invoice, Approval Workflow, Profit Sharing.
 * Komunikasi dengan domain lain: selalu lewat service method, bukan query Prisma langsung.
 */
@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    private readonly eventBus: EventBusService,
    private readonly configService: ConfigService,
    private readonly orderService: OrderService,
    private readonly inventoryService: InventoryService,
    private readonly customerService: CustomerService,
    private readonly authService: AuthService,
    private readonly activityLog: ActivityLogService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  // ==========================================
  // Payment Methods
  // ==========================================

  /**
   * POST /payments — Buat payment record + inisiasi Midtrans (untuk Snap)
   * Staff/Manajer menentukan jumlah secara eksplisit (bukan persentase tetap)
   */
  async createPayment(dto: CreatePaymentDto, actor: JwtPayload): Promise<any> {
    // Verify order exists
    const order = await prisma.order.findUnique({
      where: { id: dto.orderId },
    });

    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    // Check ownership for Customer role
    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }

    // Validate order status based on payment type (DP or PELUNASAN)
    if (dto.jenis === 'DP' && order.status !== 'MENUNGGU_PEMBAYARAN_DP') {
      throw new BadRequestException(
        `Pembayaran DP hanya diperbolehkan untuk order berstatus MENUNGGU_PEMBAYARAN_DP (status saat ini: ${order.status})`,
      );
    }
    if (dto.jenis === 'PELUNASAN' && order.status !== 'MENUNGGU_PELUNASAN') {
      throw new BadRequestException(
        `Pembayaran Pelunasan hanya diperbolehkan untuk order berstatus MENUNGGU_PELUNASAN (status saat ini: ${order.status})`,
      );
    }

    // Get customer name — via CustomerService (DDD boundary §4.1)
    const customer = await this.customerService.getCustomerByIdInternal(order.customerId);

    // Determine amount
    let jumlah = dto.jumlah;

    if (actor.actorType === ActorType.CUSTOMER) {
      // Fetch full order with items, sizes, services
      const orderWithDetails = await prisma.order.findUnique({
        where: { id: dto.orderId },
        include: {
          items: {
            include: {
              sizes: true,
              services: true,
            },
          },
        },
      });

      if (!orderWithDetails) {
        throw new NotFoundException('Order tidak ditemukan');
      }

      const subtotal = this.calculateOrderTotal(orderWithDetails);
      let discount = orderWithDetails.discountNominal ?? 0;
      if (orderWithDetails.discountPersen) {
        discount = (subtotal * orderWithDetails.discountPersen) / 100;
      }
      const netTotal = subtotal - discount;

      if (dto.jenis === 'DP') {
        // DP default checkout otomatis pelanggan: 50% dari total order
        jumlah = netTotal * 0.5;
      } else {
        // PELUNASAN
        const paidDp = await prisma.payment.aggregate({
          where: { orderId: dto.orderId, jenis: 'DP', status: 'SUCCESS' },
          _sum: { jumlah: true },
        });
        jumlah = netTotal - (paidDp._sum.jumlah ?? 0);
      }
    } else {
      // Staff flow — jumlah is mandatory
      if (jumlah === undefined || jumlah === null || jumlah <= 0) {
        throw new BadRequestException('Jumlah payment harus diisi oleh staf');
      }
    }

    if (jumlah <= 0) {
      throw new BadRequestException('Jumlah payment harus lebih dari 0');
    }

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        orderId: dto.orderId,
        jenis: dto.jenis,
        metode: dto.metode,
        jumlah,
        status: 'PENDING',
      },
    });

    // Generate invoice untuk payment ini
    await this.generateInvoiceForPayment(payment.id, dto.jenis, jumlah, dto.orderId);

    // Jika metode Midtrans Snap, inisiasi transaksi
    if (dto.metode === 'midtrans_snap') {
      const midtransResult = await this.initMidtransSnap(payment, customer?.nama ?? 'Customer');
      return {
        payment,
        midtransToken: midtransResult.token,
        midtransRedirectUrl: midtransResult.redirect_url,
      };
    }

    return { payment };
  }

  /**
   * POST /payments/webhook/midtrans — Webhook handler
   * Wajib verifikasi signature dan idempotency check
   */
  async handleMidtransWebhook(payload: any, signatureKey: string): Promise<void> {
    // 1. Verify signature
    const serverKey = this.configService.get<string>('MIDTRANS_SERVER_KEY');
    const expectedSignature = this.hashSignature(
      `${payload.order_id}${payload.status_code}${payload.gross_amount}${serverKey}`,
    );

    if (signatureKey !== expectedSignature) {
      this.logger.warn(`Invalid webhook signature for order ${payload.order_id}`);
      throw new ForbiddenException('Invalid webhook signature');
    }

    // 2. Idempotency check
    if (payload.transaction_id) {
      const existingPayment = await prisma.payment.findFirst({
        where: { webhookEventId: payload.transaction_id },
      });

      if (existingPayment) {
        this.logger.log(`Duplicate webhook ignored: ${payload.transaction_id}`);
        return; // Already processed
      }
    }

    // 3. Find payment by Midtrans order ID
    const midtransOrderId = payload.order_id; // Format: payment_{uuid}
    const paymentId = midtransOrderId.replace('payment_', '');

    const payment = await prisma.payment.findFirst({
      where: {
        OR: [{ id: paymentId }, { midtransOrderId: midtransOrderId }],
      },
      include: { order: true },
    });

    if (!payment) {
      this.logger.warn(`Payment not found for webhook: ${midtransOrderId}`);
      return;
    }

    // 4. Update payment record
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        midtransTransactionId: payload.transaction_id,
        webhookEventId: payload.transaction_id,
        verifiedAt: new Date(),
        status: this.mapMidtransStatus(payload.transaction_status),
      },
    });

    // 5. Publish appropriate event
    const status = payload.transaction_status;
    if (status === 'settlement' || status === 'capture') {
      // Fase 8: payload event WAJIB lengkap (nama/kontak pelanggan) —
      // Notification proses terpisah tidak boleh memanggil balik domain
      // lain. Ambil via CustomerService (DDD boundary §4.1).
      const customer = await this.customerService.getCustomerByIdInternal(payment.order.customerId);
      await this.eventBus.publish(
        EVENT_NAMES.PaymentSucceeded,
        new PaymentSucceededEvent(
          payment.id,
          payment.orderId,
          payment.jenis as 'DP' | 'PELUNASAN',
          payment.jumlah,
          payment.order.customerId,
          payment.order.orderNumber,
          customer?.nama ?? 'Pelanggan',
          customer?.noHp ?? null,
        ),
      );
    } else if (status === 'expire') {
      // Fase 11: enrich payload dengan kontak pelanggan untuk notifikasi WA
      const customer = await this.customerService.getCustomerByIdInternal(payment.order.customerId);
      await this.eventBus.publish(
        EVENT_NAMES.PaymentExpired,
        new PaymentExpiredEvent(
          payment.id,
          payment.orderId,
          payment.order.orderNumber,
          payment.order.customerId,
          customer?.nama ?? 'Pelanggan',
          customer?.noHp ?? null,
        ),
      );
    } else if (status === 'cancel' || status === 'deny') {
      await this.eventBus.publish(
        EVENT_NAMES.PaymentFailed,
        new PaymentFailedEvent(payment.id, payment.orderId, payload.status_message),
      );
    }
  }

  /**
   * GET /payments/:id
   */
  async getPaymentById(paymentId: string): Promise<any> {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });

    if (!payment) {
      throw new NotFoundException('Payment tidak ditemukan');
    }

    return payment;
  }

  /**
   * GET /payments — daftar payment (Fase 9.3).
   * ?orderId= untuk section Pembayaran di halaman Order;
   * tanpa filter untuk overview /finance.
   */
  async findPayments(orderId?: string, actor?: JwtPayload): Promise<any[]> {
    if (actor?.actorType === ActorType.CUSTOMER) {
      if (!orderId) {
        throw new BadRequestException('Pelanggan wajib menyertakan orderId');
      }
      await this.assertCustomerOwnsOrder(orderId, actor);
    }

    return prisma.payment.findMany({
      where: orderId ? { orderId } : undefined,
      include: {
        order: { select: { id: true, orderNumber: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==========================================
  // Invoice Methods
  // ==========================================

  /**
   * Generate invoice untuk payment
   */
  private async generateInvoiceForPayment(
    paymentId: string,
    jenis: 'DP' | 'PELUNASAN',
    jumlah: number,
    orderId: string,
  ): Promise<void> {
    // Check if invoice already exists for this payment/jenis
    const existing = await prisma.invoice.findFirst({
      where: { orderId, jenis },
    });

    if (existing) {
      // Update existing invoice
      await prisma.invoice.update({
        where: { id: existing.id },
        data: { jumlah },
      });
      return;
    }

    // Create new invoice
    await prisma.invoice.create({
      data: {
        orderId,
        jenis,
        jumlah,
        status: 'DRAFT',
      },
    });
  }

  /**
   * GET /invoices — daftar invoice (Fase 9.3).
   * ?orderId= untuk section Pembayaran di halaman Order;
   * tanpa filter untuk overview /finance.
   */
  async findInvoices(orderId?: string, actor?: JwtPayload): Promise<any[]> {
    if (actor?.actorType === ActorType.CUSTOMER) {
      if (!orderId) {
        throw new BadRequestException('Pelanggan wajib menyertakan orderId');
      }
      await this.assertCustomerOwnsOrder(orderId, actor);
    }

    return prisma.invoice.findMany({
      where: orderId ? { orderId } : undefined,
      include: {
        order: { select: { id: true, orderNumber: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==========================================
  // Cross-Domain: Internal Read Methods (DDD Boundary §4.1)
  // ==========================================
  //
  // Method `get*ForOrder(orderId)` di-export untuk dipanggil domain lain
  // dalam SATU proses (services/api). Domain lain (CustomerChat, dll)
  // TIDAK BOLEH query langsung ke tabel payments / invoices — harus
  // lewat sini.
  //
  // Nama "ForInternal" / suffix "ForOrder" = penanda jelas bahwa method
  // ini BUKAN endpoint publik dan BUKAN untuk dipanggil via HTTP.
  // Dipakai di Fase 12 Bagian 2 (CustomerChatService butuh konteks
  // pembayaran/pengiriman untuk AI auto-reply).

  /**
   * Ambil data payment untuk satu order (internal use only).
   *
   * Beda dengan `findPayments(orderId, actor)`:
   * - findPayments → endpoint publik, ada RBAC check, include order
   * - getPaymentsForOrder → internal call antar service di SATU proses,
   *   return data minimal yang dibutuhkan caller, tanpa RBAC
   *   (pengecekan akses sudah dilakukan caller — CustomerChatService
   *   sudah validateAccess() di awal).
   *
   * DDD §4.1: Caller TIDAK BOLEH query `prisma.payment.findMany` sendiri.
   */
  async getPaymentsForOrder(orderId: string): Promise<
    Array<{
      id: string;
      jenis: string;
      jumlah: number;
      status: string;
      createdAt: Date;
    }>
  > {
    return prisma.payment.findMany({
      where: { orderId },
      select: {
        id: true,
        jenis: true,
        jumlah: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Ambil data invoice untuk satu order (internal use only).
   *
   * Lihat `getPaymentsForOrder` untuk penjelasan kenapa ini method terpisah
   * dari `findInvoices(orderId, actor)`.
   */
  async getInvoicesForOrder(orderId: string): Promise<
    Array<{
      id: string;
      jenis: string;
      jumlah: number;
      status: string;
    }>
  > {
    return prisma.invoice.findMany({
      where: { orderId },
      select: {
        id: true,
        jenis: true,
        jumlah: true,
        status: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * GET /invoices/:id
   */
  async getInvoiceById(invoiceId: string, actor?: JwtPayload): Promise<any> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        order: {
          include: {
            items: {
              include: {
                sizes: true,
                services: true,
              },
            },
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice tidak ditemukan');
    }

    if (actor?.actorType === ActorType.CUSTOMER && actor.sub !== invoice.order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke invoice ini');
    }

    return this.formatInvoiceDetail(invoice);
  }

  /**
   * GET /invoices/:id/pdf — Generate PDF sungguhan (Fase 9.4, PDFKit).
   * File disimpan ke uploads/invoices/ (pola upload desain Fase 3),
   * di-serve via static /uploads — siap di-swap ke S3-compatible nanti.
   */
  async getInvoicePdf(invoiceId: string, actor?: JwtPayload): Promise<{ pdfUrl: string }> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        order: {
          include: {
            items: {
              include: {
                sizes: true,
                services: true,
              },
            },
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice tidak ditemukan');
    }

    if (actor?.actorType === ActorType.CUSTOMER && actor.sub !== invoice.order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke invoice ini');
    }

    // Nama/kontak pelanggan via CustomerService (DDD boundary §4.1)
    const customer = await this.customerService.getCustomerByIdInternal(invoice.order.customerId);

    const detail = this.formatInvoiceDetail(invoice);
    const pdfUrl = await this.invoicePdfService.generate({
      invoiceId: invoice.id,
      orderNumber: invoice.order.orderNumber,
      jenis: invoice.jenis,
      status: invoice.status,
      jumlah: invoice.jumlah,
      createdAt: invoice.createdAt,
      customerNama: customer?.nama ?? 'Pelanggan',
      customerNoHp: customer?.noHp ?? null,
      items: detail.items.map((i: any) => ({
        productType: i.productType,
        qty: i.qty,
        basePriceSnapshot: i.basePriceSnapshot,
      })),
      services: detail.services,
      subtotal: detail.subtotal,
      discount: detail.discount,
      total: detail.total,
      notes: invoice.notes,
    });

    // Simpan URL supaya konsisten dengan kolom pdf_url yang sudah ada
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { pdfUrl },
    });

    return { pdfUrl };
  }

  /**
   * Issue invoice (change status to ISSUED)
   */
  async issueInvoice(invoiceId: string): Promise<any> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { order: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice tidak ditemukan');
    }

    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException('Invoice sudah di-issue atau dibatalkan');
    }

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'ISSUED' },
    });

    // Publish InvoiceIssued event — payload lengkap dengan kontak pelanggan
    // (Fase 8): Notification proses terpisah tidak memanggil balik domain lain.
    const customer = await this.customerService.getCustomerByIdInternal(invoice.order.customerId);
    await this.eventBus.publish(
      EVENT_NAMES.InvoiceIssued,
      new InvoiceIssuedEvent(
        updated.id,
        updated.orderId,
        updated.jenis as 'DP' | 'PELUNASAN',
        updated.jumlah,
        invoice.order.orderNumber,
        invoice.order.customerId,
        customer?.nama ?? 'Pelanggan',
        customer?.noHp ?? null,
      ),
    );

    return updated;
  }

  // ==========================================
  // Approval Methods
  // ==========================================

  /**
   * POST /approvals — Ajukan approval request
   * Hanya Manajer Produksi yang bisa mengajukan
   */
  async createApproval(dto: CreateApprovalDto, actor: JwtPayload): Promise<any> {
    if (actor.role !== 'MANAJER_PRODUKSI' && actor.role !== 'OWNER') {
      throw new ForbiddenException('Hanya Manajer Produksi yang bisa mengajukan approval');
    }

    const approval = await prisma.approval.create({
      data: {
        tipe: dto.tipe,
        refId: dto.refId,
        orderId: dto.orderId, // order terkait — untuk konteks di inbox approval (Fase 9.3)
        requestedBy: actor.sub,
        alasan: dto.alasan,
      },
    });

    // Publish ApprovalRequested event — sertakan nama pengaju (Fase 8):
    // Dashboard alert Owner butuh nama, bukan cuma ID.
    const requester = await this.authService.getUserByIdInternal(actor.sub);
    await this.eventBus.publish(
      EVENT_NAMES.ApprovalRequested,
      new ApprovalRequestedEvent(
        approval.id,
        dto.tipe,
        dto.refId ?? null,
        actor.sub,
        requester?.nama ?? 'Staff',
      ),
    );

    return approval;
  }

  /**
   * PATCH /approvals/:id/decide — Putuskan approval
   * Hanya Owner yang bisa memutuskan
   */
  async decideApproval(
    approvalId: string,
    dto: DecideApprovalDto,
    actor: JwtPayload,
  ): Promise<any> {
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('Hanya Owner yang bisa memutuskan approval');
    }

    const approval = await prisma.approval.findUnique({
      where: { id: approvalId },
    });

    if (!approval) {
      throw new NotFoundException('Approval tidak ditemukan');
    }

    if (approval.status !== 'PENDING') {
      throw new BadRequestException('Approval sudah diproses');
    }

    const updated = await prisma.approval.update({
      where: { id: approvalId },
      data: {
        status: dto.status,
        approvedBy: actor.sub,
        alasan: dto.alasan,
        decidedAt: new Date(),
      },
    });

    // Execute effect based on approval type
    if (dto.status === 'APPROVED') {
      await this.executeApprovalEffect(approval, dto.alasan);
    }

    // Publish ApprovalDecided event — sertakan nama pemutus (Fase 8)
    const decider = await this.authService.getUserByIdInternal(actor.sub);

    // Activity Log (§6.8, Fase 9.4): keputusan approval = aksi penting.
    // Dicatat ke entity Order (kalau ada orderId) supaya tampil di
    // "Riwayat Aktivitas" order — fallback ke entity Approval.
    const decisionLabel = dto.status === 'APPROVED' ? 'menyetujui' : 'menolak';
    await this.activityLog.log(
      actor.sub,
      actor.role ?? null,
      `${decider?.nama ?? 'Owner'} ${decisionLabel} approval ${approval.tipe}` +
        (dto.alasan ? ` — ${dto.alasan}` : ''),
      approval.orderId ? 'Order' : 'Approval',
      approval.orderId ?? approval.id,
    );

    await this.eventBus.publish(
      EVENT_NAMES.ApprovalDecided,
      new ApprovalDecidedEvent(
        updated.id,
        updated.tipe,
        updated.status as 'APPROVED' | 'REJECTED',
        actor.sub,
        decider?.nama ?? 'Owner',
        dto.alasan,
      ),
    );

    return updated;
  }

  /**
   * Execute effect after approval is approved
   * Semua lewat service method domain pemilik
   */
  private async executeApprovalEffect(approval: any, alasan?: string): Promise<void> {
    switch (approval.tipe) {
      case 'HARGA_KHUSUS':
        if (approval.refId) {
          // Override harga via OrderService
          await this.orderService.overrideItemPrice(approval.refId, alasan ?? '');
        }
        break;

      case 'DISKON':
        if (approval.refId) {
          // Apply diskon via OrderService
          await this.orderService.applyDiscount(approval.refId, alasan ?? '');
        }
        break;

      case 'EDIT_INVOICE':
        if (approval.refId) {
          // Archive old invoice, create new via OrderService
          await this.orderService.reissueInvoice(approval.refId);
        }
        break;

      case 'REFUND':
        if (approval.refId) {
          // Fase 11: panggil Midtrans Refund API sungguhan SEBELUM efek internal
          const refundResult = await this.callMidtransRefund(approval.refId, alasan);

          // Catat status refund di payment record (untuk jejak staf)
          if (refundResult.paymentId) {
            await prisma.payment.update({
              where: { id: refundResult.paymentId },
              data: {
                status: refundResult.success ? 'SUCCESS' : 'FAILED',
              },
            });
          }

          if (!refundResult.success) {
            // Refund API gagal — JANGAN lanjutkan efek internal
            throw new BadRequestException(
              `Refund Midtrans gagal: ${refundResult.error}. Approval tidak dapat dieksekusi.`,
            );
          }

          // Efek internal (release stock + cancel order)
          await this.orderService.releaseReservationsForOrder(approval.refId);
          await this.orderService.cancelOrderByFinance(approval.refId, alasan);
        }
        break;
    }
  }

  /**
   * GET /approvals — Fase 9.3: inbox approval.
   * §5.1: Owner lihat SEMUA; Manajer hanya request yang dia ajukan sendiri.
   * Nama pengaju/pemutus di-enrich via AuthService (DDD boundary §4.1).
   */
  async getApprovals(status?: string, actor?: JwtPayload): Promise<any[]> {
    const where: any = {};
    if (status) {
      where.status = status;
    }
    // Manajer: hanya request miliknya sendiri (§5.1 "ajukan saja")
    if (actor && actor.role !== 'OWNER') {
      where.requestedBy = actor.sub;
    }

    const approvals = await prisma.approval.findMany({
      where,
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich nama staff (requestedBy/approvedBy) via AuthService
    const userIds = [
      ...new Set(
        approvals.flatMap((a) => [a.requestedBy, a.approvedBy]).filter((id): id is string => !!id),
      ),
    ];
    const users = await Promise.all(userIds.map((id) => this.authService.getUserByIdInternal(id)));
    const userMap = new Map(users.filter(Boolean).map((u) => [u!.id, u!.nama]));

    return approvals.map((a) => ({
      ...a,
      requesterNama: userMap.get(a.requestedBy) ?? null,
      approverNama: a.approvedBy ? (userMap.get(a.approvedBy) ?? null) : null,
    }));
  }

  // ==========================================
  // Profit Sharing Methods
  // ==========================================

  /**
   * POST /profit-sharing
   * Hanya Owner
   */
  async createProfitSharing(dto: CreateProfitSharingDto, actor: JwtPayload): Promise<any> {
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('Hanya Owner yang bisa mengatur bagi hasil');
    }

    return prisma.profitSharing.create({
      data: dto,
    });
  }

  /**
   * GET /profit-sharing
   * Hanya Owner
   */
  async getProfitSharing(actor: JwtPayload): Promise<any[]> {
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('Hanya Owner yang bisa melihat bagi hasil');
    }

    return prisma.profitSharing.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * PATCH /profit-sharing/:id
   * Hanya Owner
   */
  async updateProfitSharing(
    id: string,
    dto: UpdateProfitSharingDto,
    actor: JwtPayload,
  ): Promise<any> {
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('Hanya Owner yang bisa mengubah bagi hasil');
    }

    const existing = await prisma.profitSharing.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Profit sharing tidak ditemukan');
    }

    return prisma.profitSharing.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * DELETE /profit-sharing/:id
   * Hanya Owner
   */
  async deleteProfitSharing(id: string, actor: JwtPayload): Promise<void> {
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('Hanya Owner yang bisa menghapus bagi hasil');
    }

    await prisma.profitSharing.delete({ where: { id } });
  }

  // ==========================================
  // Event Listeners (consumed events)
  // ==========================================

  /**
   * Consume ProductionCompleted event
   * Auto-generate invoice Pelunasan
   *
   * IDEMPOTEN (§16): skip jika invoice PELUNASAN untuk order ini sudah ada —
   * event yang dikirim dua kali tidak menghasilkan invoice ganda.
   */
  async onProductionCompleted(orderId: string): Promise<void> {
    this.logger.log(`Production completed for order ${orderId} - generating Pelunasan invoice`);

    // Idempotency check: cek state DB dulu sebelum apply efek
    const existingInvoice = await prisma.invoice.findFirst({
      where: { orderId, jenis: 'PELUNASAN' },
    });

    if (existingInvoice) {
      this.logger.log(
        `Pelunasan invoice untuk order ${orderId} sudah ada (${existingInvoice.id}) — skip (idempotent no-op)`,
      );
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { sizes: true, services: true } } },
    });

    if (!order) return;

    // Calculate total order amount
    const subtotal = this.calculateOrderTotal(order);

    // Check if DP was paid
    const dpPayment = await prisma.payment.findFirst({
      where: { orderId, jenis: 'DP', status: 'SUCCESS' },
    });

    const pelunasanAmount = subtotal - (dpPayment?.jumlah ?? 0);

    if (pelunasanAmount > 0) {
      // Create invoice for pelunasan
      await prisma.invoice.create({
        data: {
          orderId,
          jenis: 'PELUNASAN',
          jumlah: pelunasanAmount,
          status: 'DRAFT',
        },
      });

      this.logger.log(
        `Created Pelunasan invoice: ${pelunasanAmount} for order ${order.orderNumber}`,
      );
    }
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  private async assertCustomerOwnsOrder(orderId: string, actor: JwtPayload): Promise<void> {
    const order = await this.orderService.getOrderByIdInternal(orderId);
    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }
    if (actor.actorType === ActorType.CUSTOMER && actor.sub !== order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke order ini');
    }
  }

  private async initMidtransSnap(
    payment: any,
    customerName: string,
  ): Promise<MidtransSnapResponse> {
    const serverKey = this.configService.get<string>('MIDTRANS_SERVER_KEY');
    const isProduction = this.configService.get<string>('MIDTRANS_IS_PRODUCTION') === 'true';
    const baseUrl = isProduction ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';

    const orderId = `payment_${payment.id}`;
    const params = {
      transaction_details: {
        order_id: orderId,
        gross_amount: payment.jumlah,
      },
      customer_details: {
        first_name: customerName,
      },
      credit_card: {
        secure: true,
      },
      // Fase 11: samakan expiry Snap dengan TTL reservasi (24 jam)
      expiry: {
        duration: 24,
        unit: 'hour',
      },
    };

    // Update payment with Midtrans order ID
    await prisma.payment.update({
      where: { id: payment.id },
      data: { midtransOrderId: orderId },
    });

    // Call Midtrans Snap API
    const auth = Buffer.from(serverKey + ':').toString('base64');
    const response = await fetch(`${baseUrl}/snap/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new BadRequestException(`Midtrans API error: ${error}`);
    }

    const result = await response.json();
    return {
      token: result.token,
      redirect_url: result.redirect_url,
    };
  }

  private hashSignature(data: string): string {
    return crypto.createHash('sha512').update(data).digest('hex');
  }

  /**
   * Panggil Midtrans Refund API (Fase 11).
   * Mencari payment SUCCESS untuk order, lalu POST ke /v2/{order_id}/refund.
   *
   * Return: { success, paymentId, error? }
   * - success=false + error message jika API gagal atau tidak ada payment SUCCESS
   * - success=true jika refund berhasil
   */
  private async callMidtransRefund(
    orderId: string,
    reason?: string,
  ): Promise<{ success: boolean; paymentId: string | null; error?: string }> {
    // Cari payment SUCCESS untuk order ini
    const payment = await prisma.payment.findFirst({
      where: { orderId, status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
    });

    if (!payment) {
      return {
        success: false,
        paymentId: null,
        error: 'Tidak ada pembayaran sukses untuk order ini',
      };
    }

    if (!payment.midtransOrderId) {
      return {
        success: false,
        paymentId: payment.id,
        error: 'Payment tidak punya Midtrans order ID',
      };
    }

    const serverKey = this.configService.get<string>('MIDTRANS_SERVER_KEY');
    const isProduction = this.configService.get<string>('MIDTRANS_IS_PRODUCTION') === 'true';
    const baseUrl = isProduction ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';

    const refundBody: Record<string, unknown> = {
      refund_id: `refund_${payment.id}_${Date.now()}`,
    };
    if (reason) {
      refundBody.reason = reason;
    }

    try {
      const auth = Buffer.from(serverKey + ':').toString('base64');
      const response = await fetch(`${baseUrl}/v2/${payment.midtransOrderId}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(refundBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Midtrans refund API error: ${response.status} — ${errorText}`);
        return {
          success: false,
          paymentId: payment.id,
          error: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const result = await response.json();
      this.logger.log(
        `Midtrans refund success for payment ${payment.id}: ${JSON.stringify(result)}`,
      );
      return { success: true, paymentId: payment.id };
    } catch (error: any) {
      this.logger.error(`Midtrans refund API exception: ${error.message}`);
      return { success: false, paymentId: payment.id, error: error.message };
    }
  }

  private mapMidtransStatus(
    status: string,
  ): 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'CANCELLED' {
    switch (status) {
      case 'settlement':
      case 'capture':
        return 'SUCCESS';
      case 'expire':
        return 'EXPIRED';
      case 'cancel':
      case 'deny':
        return 'CANCELLED';
      default:
        return 'PENDING';
    }
  }

  // ==========================================
  // Analytics Internal Methods (Fase 13)
  // ==========================================

  /**
   * Agregasi revenue dari payment SUCCESS dalam periode.
   * Dipanggil oleh AnalyticsService (DDD boundary).
   */
  async getRevenueByPeriod(
    from: Date,
    to: Date,
  ): Promise<{ total: number; byMonth: Array<{ month: string; total: number }> }> {
    const payments = await prisma.payment.findMany({
      where: {
        status: 'SUCCESS',
        createdAt: { gte: from, lte: to },
      },
      select: { jumlah: true, createdAt: true },
    });

    const total = payments.reduce((sum, p) => sum + p.jumlah, 0);

    const monthMap = new Map<string, number>();
    for (const p of payments) {
      const key = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, '0')}`;
      monthMap.set(key, (monthMap.get(key) ?? 0) + p.jumlah);
    }

    const byMonth = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, t]) => ({ month, total: t }));

    return { total, byMonth };
  }

  /**
   * Total biaya bahan dari purchase_orders COMPLETED dalam periode.
   * Dipanggil oleh AnalyticsService untuk kalkulasi Profit.
   */
  async getMaterialCostsByPeriod(from: Date, to: Date): Promise<number> {
    const result = await prisma.purchaseOrder.aggregate({
      where: {
        status: 'COMPLETED',
        tglBeli: { gte: from, lte: to },
      },
      _sum: { totalBiaya: true },
    });
    return result._sum.totalBiaya ?? 0;
  }

  /**
   * Hitung AOV (Average Order Value) dari payment SUCCESS dalam periode.
   * AOV = total revenue / jumlah order unik yang punya payment SUCCESS.
   */
  async getAverageOrderValue(
    from: Date,
    to: Date,
  ): Promise<{ aov: number; orderCount: number; totalRevenue: number }> {
    const payments = await prisma.payment.findMany({
      where: {
        status: 'SUCCESS',
        createdAt: { gte: from, lte: to },
      },
      select: { orderId: true, jumlah: true },
    });

    const totalRevenue = payments.reduce((sum, p) => sum + p.jumlah, 0);
    const uniqueOrderIds = new Set(payments.map((p) => p.orderId));
    const orderCount = uniqueOrderIds.size;
    const aov = orderCount > 0 ? totalRevenue / orderCount : 0;

    return { aov, orderCount, totalRevenue };
  }

  private calculateOrderTotal(order: any): number {
    let total = 0;

    for (const item of order.items) {
      const qty = item.sizes.reduce((sum: number, s: any) => sum + s.qty, 0);
      total += item.basePriceSnapshot * qty;

      for (const service of item.services) {
        total += service.tarif * qty;
      }
    }

    return total;
  }

  private formatInvoiceDetail(invoice: any): any {
    const subtotal = this.calculateOrderTotal(invoice.order);
    const discount = invoice.order.discountNominal ?? 0;

    return {
      id: invoice.id,
      orderId: invoice.orderId,
      orderNumber: invoice.order.orderNumber,
      jenis: invoice.jenis,
      jumlah: invoice.jumlah,
      status: invoice.status,
      pdfUrl: invoice.pdfUrl,
      notes: invoice.notes,
      createdAt: invoice.createdAt,
      items: invoice.order.items.map((item: any) => ({
        productType: item.productType,
        basePriceSnapshot: item.basePriceSnapshot,
        qty: item.sizes.reduce((sum: number, s: any) => sum + s.qty, 0),
        sizes: item.sizes.map((s: any) => ({ ukuran: s.ukuran, qty: s.qty })),
      })),
      services: invoice.order.items.flatMap((item: any) =>
        item.services.map((s: any) => ({ serviceType: s.serviceType, tarif: s.tarif })),
      ),
      subtotal,
      discount,
      total: subtotal - discount,
    };
  }
}
