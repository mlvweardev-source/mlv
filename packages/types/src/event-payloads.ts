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

/**
 * auth.otp.requested — WA: kirim kode OTP login pelanggan (Fase 10).
 *
 * TIDAK extends CustomerContactFields: saat OTP diminta, customer bisa
 * saja BELUM terdaftar (registrasi terjadi saat verify). Identitas satu-
 * satunya adalah nomor HP tujuan.
 *
 * PERHATIAN: `kode` adalah plaintext OTP (harus, untuk dirender ke pesan
 * WA). Event ini ditandai SENSITIF di Notification Domain — isi pesan
 * TIDAK disimpan utuh di notification_logs (di-mask) supaya staff yang
 * membuka Notification Center tidak bisa membajak login pelanggan.
 */
export interface OtpRequestedPayload {
  /**
   * Nomor HP tujuan (identifier pelanggan, terdaftar maupun belum).
   * Dinamai `customerNoHp` agar resolveRecipient generik di Dispatcher
   * (channel WHATSAPP membaca field ini) tidak perlu kasus khusus.
   */
  customerNoHp: string;
  /** Kode OTP 6 digit plaintext — hanya hidup di payload event + pesan WA. */
  kode: string;
  /** Masa berlaku dalam menit — untuk dirender di template. */
  berlakuMenit: number;
  /** Timestamp permintaan — membedakan dua request utk nomor yang sama (dedup). */
  requestedAt: string;
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
