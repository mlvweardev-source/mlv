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
