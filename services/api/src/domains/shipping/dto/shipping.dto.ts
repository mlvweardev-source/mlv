import { IsString, IsNumber, IsOptional, IsEnum, MinLength, Min } from 'class-validator';
import { ShipmentStatus } from '@mlv/db';

export class CreateShipmentDto {
  @IsString()
  @MinLength(1)
  orderId!: string;

  @IsString()
  @MinLength(1)
  kurir!: string; // Nama kurir: JNE, SiCepat, J&T, dll. (resi manual, bukan API kurir)

  @IsOptional()
  @IsString()
  noResi?: string; // Nomor resi — opsional saat create, diinput setelah handed over

  @IsOptional()
  @IsString()
  alamatPengiriman?: string; // Override alamat customer jika tujuan kirim berbeda

  @IsOptional()
  @IsNumber()
  @Min(0)
  biayaKirim?: number; // INFORMASIONAL saja — TIDAK diintegrasikan ke Finance/invoice
}

export class UpdateShipmentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  noResi?: string; // Update nomor resi setelah handed over ke kurir

  @IsOptional()
  @IsString()
  @MinLength(1)
  kurir?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  biayaKirim?: number; // Informasional saja

  @IsOptional()
  @IsString()
  alamatPengiriman?: string;

  @IsOptional()
  @IsEnum(ShipmentStatus)
  status?: ShipmentStatus; // DICATAT / DIKIRIM / DALAM_TRANSIT / DITERIMA
}

export class CreateShipmentResponseDto {
  id!: string;
  orderId!: string;
  kurir!: string;
  noResi!: string | null;
  status!: ShipmentStatus;
  alamatPengiriman!: string | null;
  biayaKirim!: number | null;
  trackingToken!: string; // dibagikan staff ke pelanggan untuk tracking publik
  shippedAt!: Date | null;
  deliveredAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

/**
 * Response tracking PUBLIK — hanya info minimal (§8, keputusan Fase 7 #4).
 * TIDAK memuat: harga/biaya kirim, alamat, data pelanggan, orderId, token.
 */
export class PublicTrackingResponseDto {
  orderNumber!: string;
  status!: string; // label human-readable, bukan enum internal
  kurir!: string;
  noResi!: string | null;
  shippedAt!: Date | null;
  deliveredAt!: Date | null;
  lastUpdate!: Date;
}
