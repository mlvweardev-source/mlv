import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { prisma } from '@mlv/db';
import type { NotificationChannel, NotificationStatus } from '@mlv/db';
import { UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';
import { GetUser, Roles } from '../auth/auth.guard';
import { DispatcherService } from './dispatcher.service';
import { DispatchNotificationDto, ListNotificationsQueryDto } from './notification.dto';

/**
 * Notification Center endpoints (§8, §12).
 *
 * RBAC (§5.1): Owner & Manajer Produksi full akses (lihat semua),
 * Tim Penjahit hanya notifikasi miliknya sendiri (userId = dirinya).
 */
@Controller('notifications')
export class NotificationController {
  constructor(private readonly dispatcher: DispatcherService) {}

  /**
   * POST /notifications/dispatch — internal-only (§8).
   * Trigger manual (jarang dipakai; jalur normal = event otomatis).
   * Owner/Manajer saja — bukan untuk Penjahit.
   */
  @Post('dispatch')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async dispatch(@Body() dto: DispatchNotificationDto) {
    const summary = await this.dispatcher.dispatchEvent(dto.eventType, dto.payload);
    return { message: 'Dispatch selesai', ...summary };
  }

  /**
   * GET /notifications — notification center (§8).
   * Owner/Manajer: semua log. Penjahit: hanya miliknya (userId = dirinya).
   */
  @Get()
  async list(@Query() query: ListNotificationsQueryDto, @GetUser() user: JwtPayload) {
    const isPenjahit = user.role === UserRole.TIM_PENJAHIT;

    const logs = await prisma.notificationLog.findMany({
      where: {
        // §5.1: Penjahit cuma lihat notifikasi yang menargetkan dirinya
        ...(isPenjahit && { userId: user.sub }),
        ...(query.channel && { channel: query.channel as NotificationChannel }),
        ...(query.status && { statusKirim: query.status as NotificationStatus }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      total: logs.length,
      notifications: logs.map((log) => ({
        id: log.id,
        eventType: log.eventType,
        channel: log.channel,
        pesan: log.pesan,
        statusKirim: log.statusKirim,
        errorMsg: log.errorMsg,
        orderId: log.orderId,
        customerId: log.customerId,
        userId: log.userId,
        createdAt: log.createdAt,
      })),
    };
  }
}
