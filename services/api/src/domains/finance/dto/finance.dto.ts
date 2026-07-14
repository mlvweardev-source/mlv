import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, Max } from 'class-validator';

// ==========================================
// Payment DTOs
// ==========================================

export class CreatePaymentDto {
  @IsUUID()
  orderId!: string;

  @IsEnum(['DP', 'PELUNASAN'])
  jenis!: 'DP' | 'PELUNASAN';

  @IsEnum(['midtrans_snap', 'transfer', 'cash'])
  metode!: 'midtrans_snap' | 'transfer' | 'cash';

  @IsNumber()
  @Min(0)
  jumlah!: number;
}

export class PaymentResponseDto {
  id!: string;
  orderId!: string;
  jenis!: string;
  metode!: string;
  jumlah!: number;
  status!: string;
  midtransOrderId?: string;
  midtransRedirectUrl?: string;
  createdAt!: Date;
}

// ==========================================
// Invoice DTOs
// ==========================================

export class InvoiceResponseDto {
  id!: string;
  orderId!: string;
  orderNumber!: string;
  jenis!: string;
  jumlah!: number;
  status!: string;
  pdfUrl?: string;
  notes?: string;
  createdAt!: Date;
}

export class InvoiceDetailResponseDto extends InvoiceResponseDto {
  items!: Array<{
    productType: string;
    basePriceSnapshot: number;
    qty: number;
    sizes: Array<{ ukuran: string; qty: number }>;
  }>;
  services!: Array<{
    serviceType: string;
    tarif: number;
  }>;
  subtotal!: number;
  discount!: number;
  total!: number;
}

// ==========================================
// Approval DTOs
// ==========================================

export class CreateApprovalDto {
  @IsEnum(['HARGA_KHUSUS', 'DISKON', 'EDIT_INVOICE', 'REFUND'])
  tipe!: 'HARGA_KHUSUS' | 'DISKON' | 'EDIT_INVOICE' | 'REFUND';

  @IsOptional()
  @IsUUID()
  refId?: string;

  @IsOptional()
  @IsString()
  alasan?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  jumlah?: number; // Untuk HARGA_KHUSUS atau DISKON
}

export class DecideApprovalDto {
  @IsEnum(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  alasan?: string;
}

export class ApprovalResponseDto {
  id!: string;
  tipe!: string;
  refId?: string;
  requestedBy!: string;
  requesterNama?: string;
  status!: string;
  approvedBy?: string;
  approverNama?: string;
  catatan?: string;
  alasan?: string;
  decidedAt?: Date;
  createdAt!: Date;
}

// ==========================================
// Profit Sharing DTOs
// ==========================================

export class CreateProfitSharingDto {
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsString()
  periode?: string;

  @IsString()
  pihak!: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  persentase!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  nominal?: number;

  @IsOptional()
  @IsString()
  catatan?: string;
}

export class UpdateProfitSharingDto {
  @IsOptional()
  @IsString()
  pihak?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  persentase?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  nominal?: number;

  @IsOptional()
  @IsString()
  catatan?: string;
}

export class ProfitSharingResponseDto {
  id!: string;
  orderId?: string;
  periode?: string;
  pihak!: string;
  persentase!: number;
  nominal?: number;
  catatan?: string;
  createdAt!: Date;
}
