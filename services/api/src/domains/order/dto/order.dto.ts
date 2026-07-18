import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  ValidateNested,
  IsNumber,
  IsInt,
  Min,
  IsDateString,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus } from '@mlv/db';
import { ProductType } from '@mlv/types';

// ==========================================
// Create Order
// ==========================================

export class CreateOrderDto {
  @IsUUID()
  customerId!: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;
}

export class CreateOrderResponseDto {
  id!: string;
  orderNumber!: string;
  customerId!: string;
  status!: OrderStatus;
  deadline!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

// ==========================================
// Add Item to Order
// ==========================================

export class OrderSizeDto {
  @IsString()
  ukuran!: string;

  @IsInt()
  @Min(1)
  qty!: number;
}

export class AddOrderItemDto {
  @IsEnum(ProductType)
  productType!: ProductType;

  @IsNumber()
  @Min(0)
  basePriceSnapshot!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderSizeDto)
  sizes!: OrderSizeDto[];

  @IsOptional()
  @IsString()
  catatanTeks?: string;
}

export class UpdateDraftOrderItemDto {
  @IsEnum(ProductType)
  productType!: ProductType;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderSizeDto)
  sizes!: OrderSizeDto[];
}

export class AddOrderItemResponseDto {
  id!: string;
  orderId!: string;
  productType!: string;
  basePriceSnapshot!: number;
  sizes!: Array<{ id: string; ukuran: string; qty: number }>;
  createdAt!: Date;
}

// ==========================================
// Upload Design
// ==========================================

export class UploadDesignDto {
  @IsOptional()
  @IsString()
  catatanTeks?: string;
}

// ==========================================
// Add Service
// ==========================================

export class AddOrderServiceDto {
  @IsString()
  serviceType!: string;

  @IsOptional()
  @IsString()
  lokasi?: string;

  @IsOptional()
  @IsString()
  ukuran?: string;

  @IsNumber()
  @Min(0)
  tarif!: number;
}

// ==========================================
// Update Status (Checkout)
// ==========================================

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}

// ==========================================
// List Orders Query (Fase 9 — portal internal)
// ==========================================

export class FindOrdersQueryDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  /** Cari berdasarkan order number (partial match, case-insensitive). */
  @IsOptional()
  @IsString()
  search?: string;
}

// ==========================================
// Response DTOs
// ==========================================

export class OrderSizeResponseDto {
  id!: string;
  ukuran!: string;
  qty!: number;
}

export class OrderDesignResponseDto {
  id!: string;
  fileUrl!: string | null;
  catatanTeks!: string | null;
  hasilEkstraksiAi!: unknown | null;
  statusKonfirmasi!: string;
  versiRevisi!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export class OrderMaterialResponseDto {
  id!: string;
  materialId!: string;
  materialNama!: string;
  qtyRequired!: number;
}

export class OrderServiceResponseDto {
  id!: string;
  serviceType!: string;
  lokasi!: string | null;
  ukuran!: string | null;
  tarif!: number;
}

export class OrderItemResponseDto {
  id!: string;
  productType!: string;
  basePriceSnapshot!: number;
  sizes!: OrderSizeResponseDto[];
  designs!: OrderDesignResponseDto[];
  materials!: OrderMaterialResponseDto[];
  services!: OrderServiceResponseDto[];
  designRevision!: {
    allowed: boolean;
    cuttingStatus: string | null;
    reason: string | null;
  };
  createdAt!: Date;
  updatedAt!: Date;
}

export class OrderPaymentResponseDto {
  id!: string;
  jenis!: string;
  metode!: string;
  jumlah!: number;
  status!: string;
  createdAt!: Date;
}

export class OrderInvoiceResponseDto {
  id!: string;
  jenis!: string;
  jumlah!: number;
  status!: string;
  pdfUrl!: string | null;
  createdAt!: Date;
}

export class OrderShipmentResponseDto {
  id!: string;
  kurir!: string;
  noResi!: string | null;
  status!: string;
  shippedAt!: Date | null;
  deliveredAt!: Date | null;
  updatedAt!: Date;
}

export class OrderTimelineEventResponseDto {
  id!: string;
  tipeEvent!: string;
  deskripsi!: string;
  actorId!: string | null;
  createdAt!: Date;
}

export class OrderResponseDto {
  id!: string;
  orderNumber!: string;
  customerId!: string;
  status!: OrderStatus;
  deadline!: Date | null;
  items!: OrderItemResponseDto[];
  timeline!: OrderTimelineEventResponseDto[];
  payments!: OrderPaymentResponseDto[];
  invoices!: OrderInvoiceResponseDto[];
  shipment!: OrderShipmentResponseDto | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export class OrderListResponseDto {
  id!: string;
  orderNumber!: string;
  customerId!: string;
  status!: OrderStatus;
  deadline!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  _count?: {
    items: number;
  };
  itemSummary!: Array<{
    productType: string;
    qty: number;
  }>;
}

// ==========================================
// Stock Reservation Error
// ==========================================

export class StockReservationErrorDto {
  materialId!: string;
  materialNama!: string;
  requested!: number;
  available!: number;
}
