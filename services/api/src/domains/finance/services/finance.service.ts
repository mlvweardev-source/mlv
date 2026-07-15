import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { prisma } from '@mlv/db';
import type { JwtPayload } from '@mlv/auth';
import { ActorType, UserRole } from '@mlv/auth';
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
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly orderService: OrderService,
    private readonly inventoryService: InventoryService,
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

    // Get customer name
    const customer = await prisma.customer.findUnique({
      where: { id: order.customerId },
    });

    // Validate jumlah
    if (dto.jumlah <= 0) {
      throw new BadRequestException('Jumlah payment harus lebih dari 0');
    }

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        orderId: dto.orderId,
        jenis: dto.jenis,
        metode: dto.metode,
        jumlah: dto.jumlah,
        status: 'PENDING',
      },
    });

    // Generate invoice untuk payment ini
    await this.generateInvoiceForPayment(payment.id, dto.jenis, dto.jumlah, dto.orderId);

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
      this.eventEmitter.emit(
        PaymentSucceededEvent.eventName,
        new PaymentSucceededEvent(
          payment.id,
          payment.orderId,
          payment.jenis as 'DP' | 'PELUNASAN',
          payment.jumlah,
          payment.order.customerId,
        ),
      );
    } else if (status === 'expire') {
      this.eventEmitter.emit(
        PaymentExpiredEvent.eventName,
        new PaymentExpiredEvent(payment.id, payment.orderId),
      );
    } else if (status === 'cancel' || status === 'deny') {
      this.eventEmitter.emit(
        PaymentFailedEvent.eventName,
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
   * GET /invoices/:id
   */
  async getInvoiceById(invoiceId: string): Promise<any> {
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

    return this.formatInvoiceDetail(invoice);
  }

  /**
   * GET /invoices/:id/pdf — Generate PDF (placeholder)
   */
  async getInvoicePdf(invoiceId: string): Promise<{ pdfUrl: string }> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { order: true },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice tidak ditemukan');
    }

    // TODO: Generate actual PDF with template
    // For now, return a placeholder URL
    return { pdfUrl: `/invoices/${invoiceId}/download.pdf` };
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

    // Publish InvoiceIssued event
    this.eventEmitter.emit(
      InvoiceIssuedEvent.eventName,
      new InvoiceIssuedEvent(
        updated.id,
        updated.orderId,
        updated.jenis as 'DP' | 'PELUNASAN',
        updated.jumlah,
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
        requestedBy: actor.sub,
        alasan: dto.alasan,
      },
    });

    // Publish ApprovalRequested event
    this.eventEmitter.emit(
      ApprovalRequestedEvent.eventName,
      new ApprovalRequestedEvent(approval.id, dto.tipe, dto.refId ?? null, actor.sub),
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

    // Publish ApprovalDecided event
    this.eventEmitter.emit(
      ApprovalDecidedEvent.eventName,
      new ApprovalDecidedEvent(
        updated.id,
        updated.tipe,
        updated.status as 'APPROVED' | 'REJECTED',
        actor.sub,
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
          // Release stock + cancel order via services
          await this.orderService.releaseReservationsForOrder(approval.refId);
          await this.orderService.cancelOrderByFinance(approval.refId, alasan);
        }
        break;
    }
  }

  /**
   * GET /approvals
   */
  async getApprovals(status?: string): Promise<any[]> {
    const where: any = {};
    if (status) {
      where.status = status;
    }

    return prisma.approval.findMany({
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
   */
  async onProductionCompleted(orderId: string): Promise<void> {
    this.logger.log(`Production completed for order ${orderId} - generating Pelunasan invoice`);

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
