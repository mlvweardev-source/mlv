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
