import { IsString, IsNumber, IsOptional, IsEnum, IsDateString, Min, MinLength } from 'class-validator';
import { StockMovementType } from '@mlv/db';

export class CreateMaterialDto {
  @IsString()
  @MinLength(1)
  nama!: string;

  @IsString()
  @MinLength(1)
  satuan!: string; // meter, pcs, roll, cone, etc.

  @IsString()
  @MinLength(1)
  kategori!: string; // kain, benang, kancing, dll.
}

export class CreateBomDto {
  @IsString()
  @MinLength(1)
  productType!: string;

  @IsString()
  materialId!: string;

  @IsNumber()
  @Min(0.001)
  qtyPerUnit!: number;
}

export class ReserveStockDto {
  @IsString()
  @MinLength(1)
  orderId!: string;

  @IsString()
  materialId!: string;

  @IsNumber()
  @Min(0.001)
  qty!: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class ReleaseStockDto {
  @IsString()
  reservationId!: string;
}

export class CreateStockMovementDto {
  @IsString()
  materialId!: string;

  @IsString()
  warehouseId!: string;

  @IsEnum(StockMovementType)
  tipe!: StockMovementType;

  @IsNumber()
  @Min(0.001)
  qty!: number;

  @IsOptional()
  @IsString()
  refType?: string;

  @IsOptional()
  @IsString()
  refId?: string;

  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class CreatePurchaseOrderDto {
  @IsString()
  @MinLength(1)
  supplier!: string;

  @IsString()
  materialId!: string;

  @IsNumber()
  @Min(0.001)
  qty!: number;

  @IsNumber()
  @Min(0)
  totalBiaya!: number;

  @IsDateString()
  tglBeli!: string;
}

export class CreateStockAdjustmentDto {
  @IsString()
  materialId!: string;

  @IsNumber()
  qtyDelta!: number; // can be negative or positive

  @IsString()
  @MinLength(1)
  alasan!: string;

  @IsOptional()
  @IsString()
  approvedBy?: string;
}
