import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { prisma } from '@mlv/db';
import type { JwtPayload } from '@mlv/auth';
import { UserRole } from '@mlv/auth';
import { AuthService } from '../../domains/identity-access/services/auth.service';

/** Callback untuk subscriber SSE */
type SubscriberCallback = (msg: {
  id: string;
  senderId: string;
  senderNama: string;
  pesan: string;
  createdAt: Date;
}) => void;

@Injectable()
export class InternalChatService {
  private readonly logger = new Logger(InternalChatService.name);

  /** In-memory subscriber map: threadId → Set of callbacks */
  private subscribers = new Map<string, Set<SubscriberCallback>>();

  constructor(private readonly authService: AuthService) {}

  /**
   * RBAC: validasi user punya akses ke thread order ini.
   * - Owner & Manajer: selalu boleh.
   * - Penjahit: hanya order dengan task assigned ke dirinya.
   *
   * @throws ForbiddenException jika tidak punya akses
   */
  async validateAccess(orderId: string, user: JwtPayload): Promise<void> {
    if (user.role === UserRole.TIM_PENJAHIT) {
      const tasks = await prisma.productionTask.findMany({
        where: {
          assignedTo: user.sub,
          orderItem: { orderId },
        },
        take: 1,
      });
      if (tasks.length === 0) {
        throw new ForbiddenException(
          'Anda tidak memiliki akses ke chat order ini — task belum ditugaskan kepada Anda',
        );
      }
    }
  }

  /**
   * Ambil thread (buat jika belum ada) + pesan dengan nama pengirim.
   */
  async getOrCreateThread(orderId: string) {
    const thread = await prisma.internalChatThread.upsert({
      where: { orderId },
      create: { orderId },
      update: {},
    });

    const messages = await prisma.internalChatMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
      include: {
        thread: {
          include: { order: { select: { orderNumber: true } } },
        },
      },
    });

    // FIX #2: batch fetch semua sender user dalam SATU query
    const senderIds = [...new Set(messages.map((m) => m.senderId))];
    const userMap = new Map<string, string>();
    if (senderIds.length > 0) {
      const users = await this.authService.getUsersByIdsInternal(senderIds);
      for (const u of users) {
        userMap.set(u.id, u.nama);
      }
    }

    return {
      id: thread.id,
      orderId: thread.orderId,
      orderNumber: messages[0]?.thread.order.orderNumber ?? '',
      messages: messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderNama: userMap.get(m.senderId) ?? m.senderId,
        pesan: m.pesan,
        createdAt: m.createdAt,
      })),
      createdAt: thread.createdAt,
    };
  }

  /**
   * Kirim pesan ke thread.
   * Setelah disimpan ke DB, push ke semua subscriber SSE.
   */
  async sendMessage(orderId: string, senderId: string, senderNama: string, pesan: string) {
    // Buat/get thread
    const thread = await prisma.internalChatThread.upsert({
      where: { orderId },
      create: { orderId },
      update: {},
    });

    const message = await prisma.internalChatMessage.create({
      data: { threadId: thread.id, senderId, pesan },
    });

    const enriched = {
      id: message.id,
      senderId: message.senderId,
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

    this.logger.debug(`Chat message posted to thread ${thread.id}: "${pesan.slice(0, 40)}..."`);
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
}
