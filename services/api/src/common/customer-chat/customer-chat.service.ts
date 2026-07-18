import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { prisma } from '@mlv/db';
import { ActorType, UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { AuthService } from '../../domains/identity-access/services/auth.service';
import { CustomerService } from '../../domains/customer/services/customer.service';

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

@Injectable()
export class CustomerChatService {
  private readonly logger = new Logger(CustomerChatService.name);

  /** In-memory subscriber map: threadId → Set of callbacks */
  private subscribers = new Map<string, Set<SubscriberCallback>>();

  constructor(
    private readonly authService: AuthService,
    private readonly customerService: CustomerService,
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
    const subs = this.subscribers.get(thread.id);
    if (subs) {
      for (const cb of subs) {
        try {
          cb(enriched);
        } catch {
          /* client disconnect */
        }
      }
    }

    this.logger.debug(
      `Customer chat message posted to thread ${thread.id} (${senderType}): "${pesan.slice(0, 40)}..."`,
    );
    return enriched;
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
