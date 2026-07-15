import { IsString, IsNumber, IsOptional, MinLength, Min } from 'class-validator';
import { ShipmentStatus } from '@mlv/db';

export class CreateShipmentDto {
  @IsString()
  @MinLength(1)
  orderId!: string;

  @IsString()
  @MinLength(1)
  kurir!: string; // Nama kurir: JNE, SiCepat, J&T, dll.

  @IsOptional()
  @IsString()
  noResi?: string; // Nomor resi — optional saat create, input manual setelah handed over

  @IsOptional()
  @IsString()
  alamatPengiriman?: string; // Override alamat customer jika berbeda

  @IsOptional()
  @IsNumber()
  @Min(0)
  biayaKirim?: number; // Informasional saja, TIDAK diintegrasikan ke Finance
}

export class UpdateShipmentDto {
  @IsOptional()
  @IsString()
  noResi?: string; // Update nomor resi setelah handed over

  @IsOptional()
  @IsString()
  kurir?: string; // Update kurir jika berubah

  @IsOptional()
  @IsNumber()
  @Min(0)
  biayaKirim?: number; // Informasional saja

  @IsOptional()
  @IsString()
  alamatPengiriman?: string; // Update alamat jika berubah

  @IsOptional()
  @IsString()
  status?: ShipmentStatus; // Update status pengiriman
}

export class CreateShipmentResponseDto {
  id!: string;
  orderId!: string;
  kurir!: string;
  noResi!: string | null;
  status!: ShipmentStatus;
  alamatPengiriman!: string | null;
  biayaKirim!: number | null;
  trackingToken!: string;
  shippedAt!: Date | null;
  deliveredAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class PublicTrackingResponseDto {
  orderNumber!: string;
  status!: string;
  kurir!: string;
  noResi!: string | null;
  shippedAt!: Date | null;
  deliveredAt!: Date | null;
  lastUpdate!: Date;
}
