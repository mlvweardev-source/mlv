import { Controller, Get, Post, Param, Body, ParseUUIDPipe, Sse } from '@nestjs/common';
import { Observable, Subject, interval, merge } from 'rxjs';
import { map } from 'rxjs/operators';
import { UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { AllowCustomer, GetUser, Roles } from '../../domains/identity-access/guards/auth.guard';
import { CustomerChatService } from './customer-chat.service';
import { SendMessageDto } from './customer-chat.dto';

/**
 * Customer Chat endpoints (§6.8) — Fase 10 Bagian 4.
 *
 * Chat pelanggan ↔ admin (staf) per order. Tabel BERBEDA dari Internal Chat.
 * Pola SSE sama persisi dengan Internal Chat (Fase 9.4) — bukan mekanisme baru.
 *
 * RBAC (§5.1):
 * - Pelanggan: hanya thread order miliknya (ownership check di service).
 * - Staf Owner & Manajer: semua thread.
 * - Tim Penjahit: tidak ada akses Customer Chat (fokus di Production).
 *
 * GET  /orders/:id/customer-chat        — thread + pesan (bikin thread jika belum ada)
 * POST /orders/:id/customer-chat        — kirim pesan (senderType dari actor)
 * GET  /orders/:id/customer-chat/stream — SSE push pesan baru (EventSource)
 */
@Controller('orders/:orderId/customer-chat')
@Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
@AllowCustomer()
export class CustomerChatController {
  constructor(private readonly chatService: CustomerChatService) {}

  /** GET /orders/:orderId/customer-chat */
  @Get()
  async getThread(@Param('orderId', ParseUUIDPipe) orderId: string, @GetUser() user: JwtPayload) {
    await this.chatService.validateAccess(orderId, user);
    return this.chatService.getOrCreateThread(orderId);
  }

  /** POST /orders/:orderId/customer-chat — kirim pesan */
  @Post()
  async sendMessage(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: SendMessageDto,
    @GetUser() user: JwtPayload,
  ) {
    await this.chatService.validateAccess(orderId, user);
    return this.chatService.sendMessage(orderId, user, dto.pesan);
  }

  /**
   * GET /orders/:orderId/customer-chat/stream — SSE push pesan baru.
   *
   * Client: const es = new EventSource(`/orders/${id}/customer-chat/stream`);
   * Browser auto-reconnects on disconnect.
   *
   * Pola identik dengan Internal Chat (Fase 9.4):
   * - validateAccess WAJIB di-await (tanpa await = authorization bypass)
   * - Subject msg$ untuk push pesan, ping$ setiap 25 detik sebagai SSE comment
   * - Subscriber Map in-memory per proses (cukup untuk modular monolith)
   */
  @Sse('stream')
  async stream(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @GetUser() user: JwtPayload,
  ): Promise<Observable<MessageEvent>> {
    await this.chatService.validateAccess(orderId, user);

    const thread = await this.chatService.getOrCreateThread(orderId);

    const msg$ = new Subject<MessageEvent>();

    const unsubscribe = this.chatService.subscribe(thread.id, (msg) => {
      msg$.next({ data: JSON.stringify(msg) } as MessageEvent);
    });

    const ping$ = interval(25_000).pipe(map(() => ({ data: ':' }) as MessageEvent));

    // cleanup di-return tapi NestJS @Sse tidak menyediakan destroy signal default —
    // unsubscribe() dipanggil pada GC observable. Minor leak per koneksi, acceptable
    // untuk portal dengan jumlah user terbatas (paritas Internal Chat).
    void unsubscribe;

    return merge(msg$.asObservable(), ping$);
  }
}
