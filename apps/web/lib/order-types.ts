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

export interface OrderItem {
  id: string;
  productType: string;
  basePriceSnapshot: number;
  sizes: OrderSize[];
  designs: OrderDesign[];
  services: Array<{
    id: string;
    serviceType: string;
    lokasi: string | null;
    ukuran: string | null;
    tarif: number;
  }>;
  designRevision: {
    allowed: boolean;
    cuttingStatus: string | null;
    reason: string | null;
  };
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  customerId: string;
  status: string;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  timeline: Array<{
    id: string;
    tipeEvent: string;
    deskripsi: string;
    createdAt: string;
  }>;
  payments: Array<{
    id: string;
    jenis: string;
    metode: string;
    jumlah: number;
    status: string;
    createdAt: string;
  }>;
  invoices: Array<{
    id: string;
    jenis: string;
    jumlah: number;
    status: string;
    pdfUrl: string | null;
    createdAt: string;
  }>;
  shipment: {
    id: string;
    kurir: string;
    noResi: string | null;
    status: string;
    shippedAt: string | null;
    deliveredAt: string | null;
    updatedAt: string;
  } | null;
}

export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
  itemSummary: Array<{ productType: string; qty: number }>;
  _count?: { items: number };
}

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  MENUNGGU_PEMBAYARAN_DP: 'Menunggu DP',
  ANTREAN: 'Antrean produksi',
  CUTTING: 'Cutting',
  PRINTING: 'Printing',
  EMBROIDERY: 'Bordir',
  SEWING: 'Jahit',
  FINISHING: 'Finishing',
  IRONING: 'Setrika',
  PACKING: 'Packing',
  SELESAI: 'Produksi selesai',
  MENUNGGU_PELUNASAN: 'Menunggu pelunasan',
  LUNAS: 'Lunas',
  DIKIRIM: 'Dikirim',
  DIBATALKAN: 'Dibatalkan',
};

export function formatRupiah(value: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(value);
}

export function formatDate(value: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
