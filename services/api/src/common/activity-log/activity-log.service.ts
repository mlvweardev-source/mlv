import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '@mlv/db';
import type { ActivityLog } from '@mlv/db';

/**
 * Activity Log Service (§6.8) — Fase 9 Bagian 4.
 *
 * Infrastruktur CROSS-CUTTING, BUKAN bounded context sendiri (sama seperti
 * Audit Log): domain manapun boleh memanggil service ini LANGSUNG
 * (in-process, synchronous) — ini utilitas bersama, bukan pelanggaran
 * boundary DDD §4.1 yang berlaku antar domain bisnis.
 *
 * BEDA dengan Audit Log (§17, forensik, append-only) — itu Fase 17.
 * Activity Log = riwayat manusiawi yang tampil di UI portal admin.
 *
 * Pencatatan sengaja fail-safe: kegagalan menulis log TIDAK boleh
 * menggagalkan aksi bisnis yang memicunya.
 */
@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  /**
   * Catat satu aktivitas.
   *
   * @param actorId   - ID staff pelaku (null untuk aksi sistem/event processor)
   * @param actorRole - Role pelaku ('OWNER' dst; 'SYSTEM' untuk otomatis)
   * @param deskripsi - Kalimat manusiawi, mis. "Order MLV-... dibatalkan"
   * @param entityType - Entitas terkait, mis. 'Order', 'ProductionTask'
   * @param entityId  - ID entitas terkait
   */
  async log(
    actorId: string | null,
    actorRole: string | null,
    deskripsi: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    try {
      await prisma.activityLog.create({
        data: { actorId, actorRole, deskripsi, entityType, entityId },
      });
    } catch (error) {
      // Fail-safe: log error, jangan lempar — aksi bisnis tetap sukses
      this.logger.error(
        `Gagal mencatat activity log (${entityType}/${entityId}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * GET /activity-log — daftar aktivitas (system-wide atau per entity).
   * Filter opsional: entityType + entityId (mis. section "Riwayat
   * Aktivitas" di halaman order).
   */
  async findAll(query: {
    entityType?: string;
    entityId?: string;
    limit?: number;
  }): Promise<ActivityLog[]> {
    return prisma.activityLog.findMany({
      where: {
        ...(query.entityType && { entityType: query.entityType }),
        ...(query.entityId && { entityId: query.entityId }),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(query.limit ?? 100, 200),
    });
  }
}
