import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { prisma } from '@mlv/db';
import { ActorType, UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { AuthService } from '../../domains/identity-access/services/auth.service';
import { CustomerService } from '../../domains/customer/services/customer.service';
import { AiAssistantService } from '../../domains/order/services/ai-assistant.service';

/** Tipe pengirim pesan — mirror enum CustomerChatSenderType di Prisma. */
type SenderType = 'customer' | 'admin' | 'ai_bot';

/** Bentuk pesan yang dikirim ke subscriber SSE / dikembalikan ke client. */
export interface ChatMessageDto {
  id: string;
  senderId: string | null;
  senderType: SenderType;
  senderNama: string;
  pesan: string;
  createdAt: Date;
}

/** Callback untuk subscriber SSE */
type SubscriberCallback = (msg: ChatMessageDto) => void;

/** Bentuk context order yang dikirim ke AI Customer Support */
interface AiSupportContext {
  orderNumber: string;
  status: string;
  items: Array<{ productType: string; qty: number; basePriceSnapshot: number }>;
  timeline: Array<{ tipeEvent: string; deskripsi: string; createdAt: string }>;
  payments: Array<{
    jenis: 'DP' | 'PELUNASAN';
    jumlah: number;
    status: string;
    createdAt: string;
  }>;
  invoices: Array<{ jenis: 'DP' | 'PELUNASAN'; jumlah: number; status: string }>;
  shipment: {
    kurir: string;
    noResi: string | null;
    status: string;
    shippedAt: string | null;
    deliveredAt: string | null;
  } | null;
}

@Injectable()
export class CustomerChatService {
  private readonly logger = new Logger(CustomerChatService.name);

  /** In-memory subscriber map: threadId → Set of callbacks */
  private subscribers = new Map<string, Set<SubscriberCallback>>();

  constructor(
    private readonly authService: AuthService,
    private readonly customerService: CustomerService,
    private readonly aiAssistantService: AiAssistantService,
  ) {}

  /**
   * RBAC (§5.1):
   * - Pelanggan: hanya thread order miliknya sendiri (ownership check).
   * - Staf Owner & Manajer: semua thread.
   * - Tim Penjahit: TIDAK boleh akses Customer Chat (fokus di Production).
   *
   * Controller sudah pakai @Roles(OWNER, MANAJER_PRODUKSI) + @AllowCustomer,
   * tapi cek di sini sebagai defense-in-depth sekaligus ownership check customer.
   *
   * @throws ForbiddenException jika tidak punya akses
   * @throws NotFoundException jika order tidak ditemukan
   */
  async validateAccess(orderId: string, user: JwtPayload): Promise<void> {
    // Defense-in-depth: Penjahit ditolak meski @Roles sudah blokir di controller
    if (user.actorType === ActorType.USER && user.role === UserRole.TIM_PENJAHIT) {
      throw new ForbiddenException(
        'Tim Penjahit tidak memiliki akses ke Customer Chat — fokus Anda di Production',
      );
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerId: true },
    });
    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    // Ownership check untuk pelanggan — pola sama dengan OrderService.getOrderById
    if (user.actorType === ActorType.CUSTOMER && user.sub !== order.customerId) {
      throw new ForbiddenException('Anda tidak memiliki akses ke chat order ini');
    }
  }

  /**
   * Ambil thread (buat jika belum ada) + pesan dengan nama pengirim.
   *customerId di-resolve dari order (sumber kebenaran), bukan dari token
   * pelanggan — supaya thread yang dibuka staf tetap terikat ke customer pemilik order.
   */
  async getOrCreateThread(orderId: string): Promise<{
    id: string;
    orderId: string;
    orderNumber: string;
    customerId: string;
    messages: ChatMessageDto[];
    createdAt: Date;
  }> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerId: true, orderNumber: true },
    });
    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    const thread = await prisma.customerChatThread.upsert({
      where: { orderId },
      create: { orderId, customerId: order.customerId },
      update: {},
    });

    const messages = await prisma.customerChatMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
    });

    // Batch resolve nama pengirim — customer & staff dipisah (BEDA sumber data)
    const customerIds = new Set<string>();
    const staffIds = new Set<string>();
    for (const m of messages) {
      if (!m.senderId) continue;
      if (m.senderType === 'customer') customerIds.add(m.senderId);
      else if (m.senderType === 'admin') staffIds.add(m.senderId);
    }

    const namaMap = new Map<string, string>();
    if (customerIds.size > 0) {
      const customers = await prisma.customer.findMany({
        where: { id: { in: [...customerIds] } },
        select: { id: true, nama: true },
      });
      for (const c of customers) namaMap.set(c.id, c.nama);
    }
    if (staffIds.size > 0) {
      const staff = await this.authService.getUsersByIdsInternal([...staffIds]);
      for (const u of staff) namaMap.set(u.id, u.nama);
    }

    return {
      id: thread.id,
      orderId: thread.orderId,
      orderNumber: order.orderNumber,
      customerId: thread.customerId,
      messages: messages.map<ChatMessageDto>((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderType: m.senderType,
        senderNama: (m.senderId && namaMap.get(m.senderId)) ?? this.defaultSenderName(m.senderType),
        pesan: m.pesan,
        createdAt: m.createdAt,
      })),
      createdAt: thread.createdAt,
    };
  }

  /**
   * Kirim pesan ke thread.
   * senderType ditentukan dari actor: CUSTOMER → 'customer', USER (staf) → 'admin'.
   * Setelah disimpan ke DB, push ke semua subscriber SSE.
   *
   * Fase 12 Bagian 2: kalau pengirim adalah CUSTOMER, panggil AI Customer
   * Support setelah pesan disimpan. Kalau AI bisa jawab dari konteks order
   * (canAnswer=true), post balasan sebagai senderType='ai_bot' dan push SSE.
   * Kalau tidak, biarkan pesan masuk — staf akan balas manual seperti biasa.
   */
  async sendMessage(orderId: string, user: JwtPayload, pesan: string): Promise<ChatMessageDto> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerId: true },
    });
    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    const senderType: SenderType = user.actorType === ActorType.CUSTOMER ? 'customer' : 'admin';
    const senderId = user.sub;

    const thread = await prisma.customerChatThread.upsert({
      where: { orderId },
      create: { orderId, customerId: order.customerId },
      update: {},
    });

    const message = await prisma.customerChatMessage.create({
      data: { threadId: thread.id, senderType, senderId, pesan },
    });

    // Resolve nama pengirim sekali untuk payload push
    const senderNama = await this.resolveSenderName(senderType, senderId);

    const enriched: ChatMessageDto = {
      id: message.id,
      senderId: message.senderId,
      senderType: message.senderType,
      senderNama,
      pesan: message.pesan,
      createdAt: message.createdAt,
    };

    // Push ke semua subscriber SSE thread ini
    this.notifySubscribers(thread.id, enriched);

    this.logger.debug(
      `Customer chat message posted to thread ${thread.id} (${senderType}): "${pesan.slice(0, 40)}..."`,
    );

    // Fase 12 Bagian 2: AI auto-reply untuk pesan dari CUSTOMER.
    // Penting: TIDAK awaited — jalankan di background supaya response
    // POST /customer-chat tidak ke-block oleh AI call. AI reply akan
    // muncul via SSE push.
    if (user.actorType === ActorType.CUSTOMER) {
      void this.tryAiAutoReply(thread.id, orderId, pesan, user.sub);
    }

    return enriched;
  }

  /**
   * Try AI auto-reply untuk pesan dari customer (§9, Fase 12 Bagian 2).
   *
   * Alur:
   * 1. Kumpulkan konteks order lengkap (status, items, timeline, payments,
   *    shipment) — semua lewat Prisma langsung, TIDAK query domain lain.
   * 2. Panggil AI gateway (lewat AiAssistantService) dengan konteks.
   * 3. Kalau canAnswer=true → post balasan sbg ai_bot + push SSE.
   * 4. Kalau canAnswer=false → tidak post apa-apa (eskalasi, staf balas manual).
   * 5. Kalau AI gagal/timeout → diam, no auto-reply (fail-safe).
   *
   * Background: tidak awaited, error di-catch supaya tidak crash caller.
   */
  private async tryAiAutoReply(
    threadId: string,
    orderId: string,
    pertanyaan: string,
    customerId: string,
  ): Promise<void> {
    try {
      // 1. Kumpulkan konteks order
      const ctx = await this.buildAiSupportContext(orderId);
      if (!ctx) return; // order sudah tidak ada (race condition)

      // 2. Panggil AI
      const response = await this.aiAssistantService.answerCustomerQuestion(
        pertanyaan,
        ctx,
        customerId,
      );
      if (!response || !response.hasil) return; // AI tidak tersedia / gagal

      const hasil = response.hasil as {
        canAnswer?: boolean;
        jawaban?: string;
        alasan_eskalasi?: string;
      };

      // 3. Kalau canAnswer=true → post balasan ai_bot
      if (hasil.canAnswer && hasil.jawaban) {
        await this.postAiBotMessage(threadId, hasil.jawaban);
        this.logger.log(`AI auto-reply posted for thread ${threadId} (order ${ctx.orderNumber})`);
      } else {
        // 4. canAnswer=false → eskalasi, TIDAK post auto-reply
        this.logger.debug(
          `AI escalated to human for thread ${threadId}: ${hasil.alasan_eskalasi ?? 'no reason'}`,
        );
      }
    } catch (error: any) {
      // 5. Fail-safe: error apapun, diam. Staf tetap bisa balas manual.
      this.logger.warn(`AI auto-reply failed for thread ${threadId}: ${error.message}`);
    }
  }

  /**
   * Post balasan AI ke thread dengan senderType='ai_bot' (senderId=null).
   * Setelah disimpan, push ke semua subscriber SSE supaya pelanggan langsung
   * melihatnya.
   */
  private async postAiBotMessage(threadId: string, pesan: string): Promise<void> {
    const message = await prisma.customerChatMessage.create({
      data: {
        threadId,
        senderType: 'ai_bot',
        senderId: null,
        pesan,
      },
    });

    const enriched: ChatMessageDto = {
      id: message.id,
      senderId: null,
      senderType: 'ai_bot',
      senderNama: this.defaultSenderName('ai_bot'),
      pesan: message.pesan,
      createdAt: message.createdAt,
    };

    this.notifySubscribers(threadId, enriched);
  }

  /**
   * Bangun konteks order lengkap untuk AI Customer Support.
   * Mengumpulkan data dari DB langsung (paritas Fase 8: payload lengkap
   * di sisi publisher, ai-gateway tidak query balik).
   */
  private async buildAiSupportContext(orderId: string): Promise<AiSupportContext | null> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { sizes: true } },
        timeline: { orderBy: { createdAt: 'asc' } },
        payments: { orderBy: { createdAt: 'asc' } },
        invoices: { orderBy: { createdAt: 'asc' } },
        shipments: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!order) return null;

    return {
      orderNumber: order.orderNumber,
      status: order.status,
      items: order.items.map((item) => ({
        productType: item.productType,
        qty: item.sizes.reduce((sum, s) => sum + s.qty, 0),
        basePriceSnapshot: item.basePriceSnapshot,
      })),
      timeline: order.timeline.map((t) => ({
        tipeEvent: t.tipeEvent,
        deskripsi: t.deskripsi,
        createdAt: t.createdAt.toISOString(),
      })),
      payments: order.payments
        .filter((p) => p.status === 'SUCCESS') // hanya yg sukses yang relevan
        .map((p) => ({
          jenis: p.jenis as 'DP' | 'PELUNASAN',
          jumlah: p.jumlah,
          status: p.status,
          createdAt: p.createdAt.toISOString(),
        })),
      invoices: order.invoices.map((i) => ({
        jenis: i.jenis as 'DP' | 'PELUNASAN',
        jumlah: i.jumlah,
        status: i.status,
      })),
      shipment: order.shipments[0]
        ? {
            kurir: order.shipments[0].kurir,
            noResi: order.shipments[0].noResi,
            status: order.shipments[0].status,
            shippedAt: order.shipments[0].shippedAt?.toISOString() ?? null,
            deliveredAt: order.shipments[0].deliveredAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  /**
   * Subscribe ke pesan baru sebuah thread.
   * @returns unsubscribe function — panggil saat koneksi client close
   */
  subscribe(threadId: string, callback: SubscriberCallback): () => void {
    if (!this.subscribers.has(threadId)) {
      this.subscribers.set(threadId, new Set());
    }
    this.subscribers.get(threadId)!.add(callback);
    return () => {
      const subs = this.subscribers.get(threadId);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) this.subscribers.delete(threadId);
      }
    };
  }

  // =====================
  // Helpers
  // =====================

  private notifySubscribers(threadId: string, msg: ChatMessageDto): void {
    const subs = this.subscribers.get(threadId);
    if (subs) {
      for (const cb of subs) {
        try {
          cb(msg);
        } catch {
          /* client disconnect */
        }
      }
    }
  }

  private async resolveSenderName(
    senderType: SenderType,
    senderId: string | null,
  ): Promise<string> {
    if (!senderId) return this.defaultSenderName(senderType);
    if (senderType === 'customer') {
      const c = await this.customerService.getCustomerByIdInternal(senderId);
      return c?.nama ?? senderId;
    }
    if (senderType === 'admin') {
      const u = await this.authService.getUserByIdInternal(senderId);
      return u?.nama ?? senderId;
    }
    return this.defaultSenderName(senderType);
  }

  private defaultSenderName(senderType: SenderType): string {
    if (senderType === 'customer') return 'Pelanggan';
    if (senderType === 'admin') return 'Admin MLV';
    return 'AI Assistant';
  }
}
