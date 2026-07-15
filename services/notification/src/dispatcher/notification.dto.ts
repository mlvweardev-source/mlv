import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * POST /notifications/dispatch — internal-only (§8).
 * Dipanggil staff/domain lain kalau perlu trigger manual (jarang;
 * jalur normal adalah event otomatis via queue).
 */
export class DispatchNotificationDto {
  /** Nama event (job name) yang templatenya mau dipakai, mis. "payment.succeeded" */
  @IsString()
  @IsNotEmpty()
  eventType!: string;

  /** Payload untuk render template — bentuknya sama dengan payload event */
  @IsObject()
  payload!: Record<string, unknown>;
}

export class ListNotificationsQueryDto {
  /** Filter channel (opsional) */
  @IsOptional()
  @IsIn(['WHATSAPP', 'EMAIL', 'DASHBOARD', 'PUSH'])
  channel?: string;

  /** Filter status kirim (opsional) */
  @IsOptional()
  @IsIn(['PENDING', 'SENT', 'FAILED'])
  status?: string;
}
