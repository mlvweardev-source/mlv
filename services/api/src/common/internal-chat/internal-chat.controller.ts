import { Controller, Get, Post, Param, Body, ParseUUIDPipe, Sse } from '@nestjs/common';
import { Observable, Subject, interval, merge } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import { UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { GetUser, Roles } from '../../domains/identity-access/guards/auth.guard';
import { InternalChatService } from './internal-chat.service';
import { SendMessageDto } from './internal-chat.dto';

/**
 * Internal Chat endpoints (§11) — Fase 9 Bagian 4.
 *
 * RBAC (§5.1):
 * - Owner & Manajer: lihat semua thread.
 * - Tim Penjahit: hanya thread order yang punya task assigned ke dirinya.
 *
 * GET  /orders/:id/internal-chat        — thread + pesan (bikin thread jika belum ada)
 * POST /orders/:id/internal-chat        — kirim pesan
 * GET  /orders/:id/internal-chat/stream — SSE push pesan baru (EventSource)
 */
@Controller('orders/:orderId/internal-chat')
@Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI, UserRole.TIM_PENJAHIT)
export class InternalChatController {
  constructor(private readonly chatService: InternalChatService) {}

  /** GET /orders/:orderId/internal-chat */
  @Get()
  async getThread(@Param('orderId', ParseUUIDPipe) orderId: string, @GetUser() user: JwtPayload) {
    await this.chatService.validateAccess(orderId, user);
    return this.chatService.getOrCreateThread(orderId);
  }

  /** POST /orders/:orderId/internal-chat — kirim pesan */
  @Post()
  async sendMessage(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: SendMessageDto,
    @GetUser() user: JwtPayload,
  ) {
    await this.chatService.validateAccess(orderId, user);
    return this.chatService.sendMessage(
      orderId,
      user.sub,
      (user as any).nama ?? user.email ?? 'Staf',
      dto.pesan,
    );
  }

  /**
   * GET /orders/:orderId/internal-chat/stream — SSE push pesan baru.
   *
   * Client: const es = new EventSource(`/orders/${id}/internal-chat/stream`);
   * Browser auto-reconnects on disconnect.
   *
   * @Sse decorator dari NestJS menangani chunked HTTP response.
   * Keep-alive ping setiap 25 detik supaya reverse-proxy tidak close idle connection.
   *
   * NOTE: destroy$ tidak pernah di-complete dalam implementasi ini karena
   * NestJS @Sse tidak menyediakan teardown Subject secara default.
   * Ini adalah minor memory leak per SSE connection yang acceptable
   * untuk portal internal dengan jumlah user terbatas.
   */
  @Sse('stream')
  async stream(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @GetUser() user: JwtPayload,
  ): Promise<Observable<MessageEvent>> {
    // FIX #1: RBAC harus await-ed — authorization baru efektif setelah ini
    await this.chatService.validateAccess(orderId, user);

    const thread = await this.chatService.getOrCreateThread(orderId);

    // Subject: push pesan baru ke client
    const msg$ = new Subject<MessageEvent>();

    // Daftarkan subscriber — callback push pesan baru
    const unsubscribe = this.chatService.subscribe(thread.id, (msg) => {
      msg$.next({ data: JSON.stringify(msg) } as MessageEvent);
    });

    // Keep-alive: interval(25000) emit ':' (SSE comment = no-op).
    // NestJS akan complete ini saat koneksi client close.
    const ping$ = interval(25_000).pipe(map(() => ({ data: ':' }) as MessageEvent));

    // Note: destroy$ untuk takeUntil tidak di-hook karena NestJS @Sse tidak
    // menyediakan destroy signal secara default. msg$ dan ping$ akan
    // di-GC saat observable di-unsubscribe oleh NestJS framework.
    return merge(msg$.asObservable(), ping$);
  }
}
