// ==============================================
// Kontrak Payload Event — Fase 8 (§7, §12)
//
// Notification Domain (services/notification) adalah PROSES TERPISAH.
// Ia TIDAK BOLEH memanggil balik service domain lain untuk mengambil
// data (nama/kontak pelanggan, dll) — payload event dari domain
// penerbit HARUS sudah lengkap untuk render pesan notifikasi.
//
// Interface di file ini adalah kontrak lintas proses untuk event yang
// dipakai Notification me-render template (§6.7). Class event di
// services/api WAJIB `implements` interface terkait — drift kontrak
// akan gagal compile, bukan gagal diam-diam di runtime.
// ==============================================

/** Field kontak pelanggan yang dibutuhkan channel customer-facing (WA). */
export interface CustomerContactFields {
  customerId: string;
  customerNama: string;
  /** Nomor HP untuk channel WHATSAPP — null jika pelanggan belum mengisi. */
  customerNoHp: string | null;
}

/** payment.succeeded — WA: "Pembayaran diterima, pesanan masuk antrean" (§7.2) */
export interface PaymentSucceededPayload extends CustomerContactFields {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  jenis: 'DP' | 'PELUNASAN';
  jumlah: number;
}

/** invoice.issued — WA ke pelanggan */
export interface InvoiceIssuedPayload extends CustomerContactFields {
  invoiceId: string;
  orderId: string;
  orderNumber: string;
  jenis: 'DP' | 'PELUNASAN';
  jumlah: number;
}

/** shipment.created — WA ke pelanggan (sertakan no resi) */
export interface ShipmentCreatedPayload extends CustomerContactFields {
  shipmentId: string;
  orderId: string;
  orderNumber: string;
  kurir: string;
  noResi: string | null;
  trackingToken: string;
}

/** production.completed — WA opsional: "produksi selesai, menunggu pelunasan" */
export interface ProductionCompletedPayload extends CustomerContactFields {
  orderId: string;
  orderNumber: string;
}

/** stock.low — Dashboard: alert Manajer/Owner */
export interface StockLowPayload {
  materialId: string;
  materialNama: string;
  warehouseId: string;
  qtyAvailable: number;
  limit: number;
}

/** approval.requested — Dashboard: alert Owner */
export interface ApprovalRequestedPayload {
  approvalId: string;
  tipe: string;
  refId: string | null;
  requestedBy: string;
  requestedByNama: string;
}

/** approval.decided — Dashboard */
export interface ApprovalDecidedPayload {
  approvalId: string;
  tipe: string;
  status: 'APPROVED' | 'REJECTED';
  decidedBy: string;
  decidedByNama: string;
  alasan?: string;
}
