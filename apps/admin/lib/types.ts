// Tipe response API yang dipakai portal admin (subset dari DTO services/api).

import type { StaffRole } from './auth';

export interface StaffUser {
  id: string;
  email: string;
  nama: string;
  role: StaffRole;
}

export type OrderStatus =
  | 'DRAFT'
  | 'MENUNGGU_PEMBAYARAN_DP'
  | 'ANTREAN'
  | 'CUTTING'
  | 'PRINTING'
  | 'EMBROIDERY'
  | 'SEWING'
  | 'FINISHING'
  | 'IRONING'
  | 'PACKING'
  | 'SELESAI'
  | 'MENUNGGU_PELUNASAN'
  | 'LUNAS'
  | 'DIKIRIM'
  | 'DIBATALKAN';

export const ORDER_STATUSES: OrderStatus[] = [
  'DRAFT',
  'MENUNGGU_PEMBAYARAN_DP',
  'ANTREAN',
  'CUTTING',
  'PRINTING',
  'EMBROIDERY',
  'SEWING',
  'FINISHING',
  'IRONING',
  'PACKING',
  'SELESAI',
  'MENUNGGU_PELUNASAN',
  'LUNAS',
  'DIKIRIM',
  'DIBATALKAN',
];

export interface OrderListItem {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { items: number };
}

export interface OrderSize {
  id: string;
  ukuran: string;
  qty: number;
}

export interface OrderDesign {
  id: string;
  fileUrl: string | null;
  catatanTeks: string | null;
  /** Hasil analisis AI dari Design Analyzer (Fase 12). Struktur fleksibel. */
  hasilEkstraksiAi?: Record<string, unknown> | null;
  statusKonfirmasi: string;
  versiRevisi: number;
  createdAt: string;
}

export interface OrderMaterial {
  id: string;
  materialId: string;
  materialNama: string;
  qtyRequired: number;
}

export interface OrderServiceItem {
  id: string;
  serviceType: string;
  lokasi: string | null;
  ukuran: string | null;
  tarif: number;
}

export interface OrderItem {
  id: string;
  productType: string;
  basePriceSnapshot: number;
  sizes: OrderSize[];
  designs: OrderDesign[];
  materials: OrderMaterial[];
  services: OrderServiceItem[];
  createdAt: string;
}

export interface TimelineEvent {
  id: string;
  tipeEvent: string;
  deskripsi: string;
  actorId: string | null;
  createdAt: string;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  deadline: string | null;
  items: OrderItem[];
  timeline: TimelineEvent[];
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// Production Domain (Fase 9 Bagian 2)
// ==========================================

export type TaskType =
  'CUTTING' | 'PRINTING' | 'EMBROIDERY' | 'SEWING' | 'FINISHING' | 'IRONING' | 'PACKING';

/** Urutan kolom kanban = urutan tahap produksi §25.1. */
export const TASK_TYPES: TaskType[] = [
  'CUTTING',
  'PRINTING',
  'EMBROIDERY',
  'SEWING',
  'FINISHING',
  'IRONING',
  'PACKING',
];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  CUTTING: 'Cutting',
  PRINTING: 'Printing',
  EMBROIDERY: 'Embroidery',
  SEWING: 'Sewing',
  FINISHING: 'Finishing',
  IRONING: 'Ironing',
  PACKING: 'Packing',
};

export type TaskStatus = 'DITERIMA' | 'MENUNGGU' | 'SEDANG_DILAKSANAKAN' | 'SELESAI';

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  MENUNGGU: 'Menunggu',
  DITERIMA: 'Siap Dikerjakan',
  SEDANG_DILAKSANAKAN: 'Dikerjakan',
  SELESAI: 'Selesai',
};

export interface ProductionTask {
  id: string;
  orderItemId: string;
  taskType: TaskType;
  sequence: number;
  status: TaskStatus;
  assignedTo: string | null;
  assignedToUser?: { id: string; nama: string; email: string } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  orderItem?: {
    id: string;
    productType: string;
    orderId: string;
    order?: {
      id: string;
      orderNumber: string;
      customerId: string;
      status: string;
    };
  };
}

// ==========================================
// Inventory Domain (Fase 9 Bagian 2)
// ==========================================

export interface Material {
  id: string;
  nama: string;
  satuan: string;
  kategori: string;
  createdAt: string;
  updatedAt: string;
}

export interface BomRow {
  id: string;
  productType: string;
  materialId: string;
  qtyPerUnit: number;
  material: Material;
}

export interface StockBalanceRow {
  materialId: string;
  warehouseId: string;
  qtyAvailable: number;
  qtyReserved: number;
  updatedAt: string;
  material: Material;
  warehouse: { id: string; nama: string; lokasi: string };
}

export type PurchaseOrderStatus = 'PENDING' | 'COMPLETED';

export interface PurchaseOrderRow {
  id: string;
  supplier: string;
  materialId: string;
  qty: number;
  totalBiaya: number;
  tglBeli: string;
  status: PurchaseOrderStatus;
  createdAt: string;
  material: Material;
}

export interface StockAdjustmentRow {
  id: string;
  materialId: string;
  qtyDelta: number;
  alasan: string;
  approvedBy: string | null;
  createdAt: string;
  material: Material;
}

// ==========================================
// Finance Domain (Fase 9 Bagian 3)
// ==========================================

export type PaymentType = 'DP' | 'PELUNASAN';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Pending',
  SUCCESS: 'Sukses',
  FAILED: 'Gagal',
  EXPIRED: 'Kadaluarsa',
  CANCELLED: 'Dibatalkan',
};

export interface PaymentRow {
  id: string;
  orderId: string;
  jenis: PaymentType;
  metode: string;
  jumlah: number;
  status: PaymentStatus;
  midtransOrderId: string | null;
  verifiedAt: string | null;
  createdAt: string;
  order?: { id: string; orderNumber: string; status: string };
}

export interface CreatePaymentResult {
  payment: PaymentRow;
  midtransToken?: string;
  midtransRedirectUrl?: string;
}

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED' | 'REFUNDED';

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Diterbitkan',
  PAID: 'Dibayar',
  CANCELLED: 'Dibatalkan',
  REFUNDED: 'Direfund',
};

export interface InvoiceRow {
  id: string;
  orderId: string;
  jenis: PaymentType;
  jumlah: number;
  status: InvoiceStatus;
  pdfUrl: string | null;
  createdAt: string;
  order?: { id: string; orderNumber: string; status: string };
}

export type ApprovalType = 'HARGA_KHUSUS' | 'DISKON' | 'EDIT_INVOICE' | 'REFUND';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  HARGA_KHUSUS: 'Harga Khusus',
  DISKON: 'Diskon',
  EDIT_INVOICE: 'Edit Invoice',
  REFUND: 'Refund',
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: 'Menunggu',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
};

export interface ApprovalRow {
  id: string;
  tipe: ApprovalType;
  refId: string | null;
  orderId: string | null;
  requestedBy: string;
  requesterNama: string | null;
  status: ApprovalStatus;
  approvedBy: string | null;
  approverNama: string | null;
  alasan: string | null;
  decidedAt: string | null;
  createdAt: string;
  order?: { id: string; orderNumber: string; status: string } | null;
}

export interface ProfitSharingRow {
  id: string;
  orderId: string | null;
  periode: string | null;
  pihak: string;
  persentase: number;
  nominal: number | null;
  catatan: string | null;
  createdAt: string;
}

// ==========================================
// Shipping Domain (Fase 9 Bagian 3)
// ==========================================

export type ShipmentStatus = 'DICATAT' | 'DIKIRIM' | 'DALAM_TRANSIT' | 'DITERIMA';

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  DICATAT: 'Dicatat',
  DIKIRIM: 'Dikirim',
  DALAM_TRANSIT: 'Dalam Transit',
  DITERIMA: 'Diterima',
};

export interface ShipmentRow {
  id: string;
  orderId: string;
  kurir: string;
  noResi: string | null;
  status: ShipmentStatus;
  alamatPengiriman: string | null;
  biayaKirim: number | null;
  trackingToken: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// Analytics Domain (Fase 13)
// ==========================================

export interface DashboardData {
  period: { from: string; to: string };
  omzet?: { total: number; byMonth: Array<{ month: string; total: number }> };
  profit?: {
    total: number;
    revenue: number;
    materialCost: number;
    productionCost: number;
    note: string;
  };
  aov?: { value: number; orderCount: number; totalRevenue: number };
  orderCounts: { total: number; active: number; completed: number; cancelled: number };
  conversionRate: { draftCount: number; confirmedCount: number; rate: number };
  topProducts: Array<{ productType: string; qty: number; revenue: number }>;
  topCustomers: Array<{ customerId: string; nama: string; orderCount: number; totalSpent: number }>;
  leadTime: { averageHours: number | null; note: string };
  onTimeDelivery: { total: number; onTime: number; rate: number };
  rejectRate: { total: number; rejected: number; rate: number };
  stockAccuracy: { totalMovements: number; adjustments: number; accuracy: number; note: string };
  repeatCustomer: { totalActive: number; repeatCount: number; rate: number };
  responseTimeCS: { averageMinutes: number | null; note: string };
}
