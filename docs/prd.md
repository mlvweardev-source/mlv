# PRD — MLV: Sistem Manajemen Konveksi & Pemesanan Online Terintegrasi AI

|                     |                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **Versi Dokumen**   | 2.1 (klarifikasi hasil kickoff Fase 0 bersama AI Agent)                                      |
| **Tanggal**         | 12 Juli 2026                                                                                 |
| **Status**          | Draft — siap untuk implementasi bertahap                                                     |
| **Menggantikan**    | PRD v1.0 "GarmentFlow" — struktur diubah total dari berbasis halaman menjadi berbasis domain |
| **Ditujukan untuk** | Tim pengembang / AI Coding Agent                                                             |

> **Catatan perubahan nama:** Aplikasi berganti nama dari "GarmentFlow" menjadi **"MLV"**. Seluruh referensi nama di dokumen ini, kode, database, dan environment variable menggunakan `MLV`.

> **Changelog v2.1:** Menetapkan Turborepo + pnpm workspaces sebagai monorepo manager (§18); menghapus ambiguitas lokasi Prisma — disatukan di `packages/db`, folder `prisma/` root dihapus dari struktur (§19); memperjelas bahwa `services/inventory` adalah _placeholder_ untuk Fase 0–2, bukan service NestJS aktif, sesuai prinsip modular monolith (§18.1, §19). Perubahan ini muncul dari pertanyaan klarifikasi AI Agent saat memulai Fase 0.

---

## 1. Ringkasan Eksekutif

MLV adalah sistem manajemen konveksi full-stack bergaya **ERP ringan**, dirancang dengan pendekatan **Domain-Driven Design (DDD)** dan **Event-Driven Architecture** agar mudah dikembangkan bertahap oleh AI Coding Agent tanpa modul saling tercampur. Sistem mencakup:

1. **Website publik** — pelanggan memesan produk (kaos, kemeja, hoodie, topi, tas, dll), upload desain, membayar DP, tracking mandiri, dan mengelola akun (Customer Portal).
2. **Portal internal** — Owner, Manajer Produksi, dan Tim Penjahit mengelola pesanan, produksi, stok bahan (dengan logika ERP: BOM, Warehouse, Movement), keuangan, dan pengiriman — semua tersinkron otomatis dari pesanan online.
3. **AI Domain** — enam layanan AI terpisah (Design Analyzer, Quotation Assistant, Customer Support, Production Assistant, Inventory Prediction, Sales Insight) berbasis Gemini API, masing-masing dengan kontrak API sendiri.

---

## 2. Tujuan & Sasaran Terukur

| Tujuan                               | Indikator Keberhasilan (KPI)                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Memangkas waktu nego manual          | Order online → terverifikasi masuk antrean < 15 menit tanpa interaksi manual                                 |
| Mengurangi salah input desain/ukuran | Data terstruktur by-design; selisih data pesanan vs eksekusi mendekati 0%                                    |
| Skalabilitas arsitektur              | Domain baru (mis. produk baru, channel notifikasi baru) bisa ditambah tanpa mengubah domain lain             |
| Kontrol stok akurat (ERP)            | Tidak ada perubahan stok yang tidak tercatat di `stock_movements`                                            |
| Visibilitas operasional              | Owner bisa melihat status bisnis real-time lewat Dashboard Analytics tanpa tanya tim                         |
| Keamanan & akuntabilitas             | Semua perubahan data sensitif tercatat di Audit Log; semua aksi berisiko finansial melalui Approval Workflow |

---

## 3. Ruang Lingkup

### 3.1 Termasuk (In-Scope)

- Website publik + Customer Portal (riwayat, invoice, upload revisi, chat, repeat order, review).
- Portal internal RBAC (Owner, Manajer Produksi, Tim Penjahit) + Internal Chat per-order.
- 8 domain inti: Customer, Order, Production, Inventory, Finance, Shipping, Notification, AI — lihat §4.
- Inventory bergaya ERP penuh: Material, BOM, Warehouse, Stock, Reservation, Movement, Purchase, Adjustment.
- Production Task granular (Cutting, Printing, Embroidery, Sewing, Finishing, Ironing, Packing) + Timeline event.
- Event-Driven integration antar domain (Redis + BullMQ).
- Approval Workflow untuk harga khusus/diskon/edit invoice/refund.
- Dashboard Analytics & KPI operasional.
- Integrasi payment gateway (Midtrans), Gemini AI, WhatsApp Business API.
- Testing strategy, CI/CD, monitoring/observability.

### 3.2 Tidak Termasuk (Out-of-Scope) — fase awal

- Aplikasi mobile native.
- Multi-gudang lintas kota dengan logistik antar-gudang otomatis (skema Warehouse disiapkan strukturnya, tapi fitur transfer antar-gudang menyusul).
- Marketplace pihak ketiga (Shopee/Tokopedia).
- Modul akuntansi pajak formal.

---

## 4. Arsitektur Perangkat Lunak — Domain-Driven Design

Sistem dipecah menjadi **bounded context** berikut. Setiap domain memiliki tanggung jawab, model data, dan event sendiri — komunikasi antar domain **hanya** lewat event atau API kontrak, tidak saling mengakses tabel domain lain secara langsung.

| Domain           | Tanggung Jawab Utama                                                          | Event Dipublikasikan                                                                         | Event Dikonsumsi                                                    |
| ---------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Customer**     | Identitas pelanggan, profil, auth pelanggan, portal                           | `CustomerRegistered`, `CustomerProfileUpdated`                                               | `OrderCompleted` (untuk prompt repeat order)                        |
| **Order**        | Siklus hidup pesanan: item, ukuran, desain, kebutuhan bahan, layanan tambahan | `OrderCreated`, `OrderConfirmed`, `OrderCancelled`, `OrderStatusChanged`                     | `PaymentSucceeded`, `ProductionCompleted`, `StockReservationFailed` |
| **Production**   | Task produksi granular, penugasan, timeline                                   | `TaskStarted`, `TaskCompleted`, `ProductionCompleted`                                        | `OrderConfirmed`, `StockReserved`                                   |
| **Inventory**    | Material, BOM, Warehouse, Stock, Reservation, Movement, Purchase, Adjustment  | `StockReserved`, `StockReservationReleased`, `StockDeducted`, `StockLow`                     | `OrderConfirmed`, `PaymentFailed`, `PaymentExpired`                 |
| **Finance**      | Payment, Invoice, Bagi Hasil, Approval                                        | `PaymentSucceeded`, `PaymentFailed`, `InvoiceIssued`, `ApprovalRequested`, `ApprovalDecided` | `OrderCreated`, `ProductionCompleted`                               |
| **Shipping**     | Kurir, resi, status pengiriman                                                | `ShipmentCreated`, `ShipmentDelivered`                                                       | `PaymentSucceeded` (pelunasan)                                      |
| **Notification** | Dispatch multi-channel (WA, Email, Dashboard, Push), notification center      | `NotificationSent`, `NotificationFailed`                                                     | Hampir seluruh event domain lain (subscriber umum)                  |
| **AI**           | 6 layanan AI independen (lihat §9) sebagai supporting domain lintas konteks   | —                                                                                            | dipanggil sinkron via API oleh domain lain yang butuh               |

> **Catatan/Rekomendasi:** Selain 8 domain di atas, kami sarankan **Identity & Access** sebagai _supporting domain_ tersendiri (bukan bagian dari Customer Domain), karena autentikasi internal (RBAC Owner/Manajer/Penjahit) secara konsep berbeda dari autentikasi pelanggan. Ini murni pemisahan tanggung jawab kode, tidak menambah kompleksitas fitur.

### 4.1 Prinsip Implementasi DDD untuk AI Agent

- Setiap domain = 1 modul NestJS (`src/domains/<nama-domain>/`) dengan struktur internal: `entities/`, `dto/`, `services/`, `controllers/`, `events/`, `repository/`.
- Domain **tidak boleh** melakukan query langsung ke tabel domain lain — harus lewat event atau memanggil service/API domain terkait.
- Setiap domain punya `*.module.ts` sendiri yang di-import ke root `AppModule` — memudahkan pemisahan jadi microservice di masa depan bila diperlukan (lihat §18.1 rekomendasi _modular monolith_).

---

## 5. Peran Pengguna & RBAC

| Peran                | Deskripsi           | Domain yang Diakses                                                             |
| -------------------- | ------------------- | ------------------------------------------------------------------------------- |
| **Pelanggan**        | Publik yang memesan | Customer, Order (view own), Shipping (tracking), Notification (chat)            |
| **Owner**            | Pemilik usaha       | Semua domain, termasuk Approval & Dashboard Analytics penuh                     |
| **Manajer Produksi** | Operasional harian  | Order, Production, Inventory, Shipping (full); Finance (view + ajukan approval) |
| **Tim Penjahit**     | Eksekutor produksi  | Production (hanya task miliknya), Order (view terbatas)                         |

### 5.1 Matriks Hak Akses

| Domain/Modul                     |       Owner       |     Manajer Produksi      |       Tim Penjahit       |
| -------------------------------- | :---------------: | :-----------------------: | :----------------------: |
| Customer Domain                  |      ✅ Full      |          👁️ View          |            ❌            |
| Order Domain                     |      ✅ Full      |          ✅ Full          |  🔸 View order miliknya  |
| Production Domain                |      ✅ Full      |          ✅ Full          | 🔸 Update task miliknya  |
| Inventory Domain                 |      ✅ Full      |          ✅ Full          |         👁️ View          |
| Finance Domain (Payment/Invoice) |      ✅ Full      |          👁️ View          |            ❌            |
| Finance Domain (Bagi Hasil)      |      ✅ Full      |            ❌             |            ❌            |
| Approval Workflow                | ✅ Approve/Reject |      🔸 Ajukan saja       |            ❌            |
| Shipping Domain                  |      ✅ Full      |          ✅ Full          |            ❌            |
| Notification Center              |      ✅ Full      |          ✅ Full          |  👁️ View milik sendiri   |
| Internal Chat                    |  ✅ Semua thread  |      ✅ Semua thread      | 🔸 Thread order miliknya |
| Dashboard Analytics              |      ✅ Full      | 🔸 Terbatas (operasional) |            ❌            |
| Manajemen User & Role            |      ✅ Full      |            ❌             |            ❌            |

---

## 6. Model Data per Domain

### 6.1 Customer Domain

| Tabel                   | Field Kunci                                             |
| ----------------------- | ------------------------------------------------------- |
| `customers`             | id, nama, no_hp, email, google_id, alamat, created_at   |
| `customer_auth_methods` | customer_id, tipe (otp_hp/google), identifier           |
| `reviews`               | id, order_id, customer_id, rating, komentar, created_at |

### 6.2 Order Domain (dinormalisasi — sesuai revisi)

| Tabel                   | Field Kunci                                                                                           | Catatan                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `orders`                | **id, customer_id, status, deadline, created_at**                                                     | Tabel inti dibuat seminimal mungkin                               |
| `order_items`           | id, order_id, product_type (Kaos/Kemeja/Hoodie/Topi/Tas/...), base_price_snapshot                     | Satu order bisa berisi banyak jenis produk                        |
| `order_sizes`           | id, order_item_id, ukuran, qty                                                                        |                                                                   |
| `order_designs`         | id, order_item_id, file_url, catatan_teks, hasil_ekstraksi_ai (JSON), status_konfirmasi, versi_revisi | `versi_revisi` mendukung fitur "Upload Revisi" di Customer Portal |
| `order_materials`       | id, order_item_id, material_id, qty_required                                                          | Dihitung otomatis dari BOM × qty, bukan input manual              |
| `order_services`        | id, order_item_id, service_type (bordir/sablon/dll), lokasi, ukuran, tarif                            | Layanan tambahan di luar bahan dasar                              |
| `order_timeline_events` | id, order_id, tipe_event, deskripsi, actor_id, timestamp                                              | Sumber data untuk fitur Timeline (§10)                            |

### 6.3 Production Domain

| Tabel                 | Field Kunci                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `production_routings` | id, product_type, urutan_task (JSON array: Cutting → Printing → Sewing → ...)                                                              | Template urutan proses per jenis produk (konsep ERP: _Routing_, pasangan dari BOM) |
| `production_tasks`    | id, order_item_id, task_type (Cutting/Printing/Embroidery/Sewing/Finishing/Ironing/Packing), assigned_to, status, started_at, completed_at | Dibuat otomatis dari `production_routings` saat `OrderConfirmed`                   |

> **Catatan ERP:** BOM (§6.4) menjawab "bahan apa yang dibutuhkan", **Routing** menjawab "proses apa dan urutan apa yang dibutuhkan". Keduanya sepasang konsep standar manufacturing yang membuat sistem ini benar-benar berperilaku seperti ERP produksi, bukan sekadar tracker status.

### 6.4 Inventory Domain (ERP-style — sesuai revisi)

| Tabel                | Field Kunci                                                                                                        | Catatan                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `materials`          | id, nama, satuan, kategori                                                                                         | Master data bahan                                                                                                       |
| `bill_of_materials`  | id, product_type, material_id, qty_per_unit                                                                        | Contoh: Kaos → 2.3 m kain, 1 label, 1 plastik, 1 hangtag, 0.3 cone benang                                               |
| `warehouses`         | id, nama, lokasi                                                                                                   | Disiapkan untuk multi-gudang di masa depan                                                                              |
| `stock_balances`     | material_id, warehouse_id, qty_available, qty_reserved                                                             | **Nilai ini adalah cache/hasil agregasi**, bukan sumber kebenaran                                                       |
| `stock_reservations` | id, order_id, material_id, qty, status (active/released/consumed), expires_at                                      | Reservasi sementara saat checkout                                                                                       |
| `stock_movements`    | id, material_id, warehouse_id, tipe (in/out/reserve/release/adjust), qty, ref_type, ref_id, created_by, created_at | **Sumber kebenaran tunggal.** Semua perubahan stok WAJIB lewat tabel ini, tidak ada update langsung ke `stock_balances` |
| `purchase_orders`    | id, supplier, material_id, qty, total_biaya, tgl_beli, status                                                      | Menggantikan `material_purchase_log` versi lama                                                                         |
| `stock_adjustments`  | id, material_id, qty_delta, alasan, approved_by                                                                    | Untuk selisih stok opname                                                                                               |

### 6.5 Finance Domain

| Tabel            | Field Kunci                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `payments`       | id, order_id, jenis (DP/Pelunasan), metode, jumlah, status, webhook_event_id, verified_at                          |
| `invoices`       | id, order_id, jenis, jumlah, status, pdf_url                                                                       |
| `profit_sharing` | id, order_id/periode, pihak, persentase, nominal                                                                   |
| `approvals`      | id, tipe (harga_khusus/diskon/edit_invoice/refund), ref_id, requested_by, status, approved_by, catatan, created_at |

### 6.6 Shipping Domain

| Tabel       | Field Kunci                          |
| ----------- | ------------------------------------ |
| `shipments` | id, order_id, kurir, no_resi, status |

### 6.7 Notification Domain

| Tabel                    | Field Kunci                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `notification_templates` | id, event_type, channel, template_body                                                                |
| `notification_logs`      | id, customer_id/user_id, order_id, channel (WA/Email/Dashboard/Push), pesan, status_kirim, created_at |

### 6.8 Log & Komunikasi (Cross-cutting)

| Tabel                    | Field Kunci                                                            | Tujuan                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `audit_log`              | id, user_id, aksi, entitas, sebelum (JSON), sesudah (JSON), timestamp  | **Keamanan & compliance** — siapa mengubah data apa                                                                            |
| `activity_log`           | id, actor_id, actor_role, deskripsi, entity_type, entity_id, timestamp | **Histori operasional** — bahasa manusia, mis. _"Manajer mengubah penjahit order #123 ke Budi"_, ditampilkan di timeline order |
| `internal_chat_threads`  | id, order_id                                                           | Diskusi internal Owner ↔ Manajer ↔ Penjahit per-order                                                                          |
| `internal_chat_messages` | id, thread_id, sender_id, pesan, created_at                            |                                                                                                                                |
| `customer_chat_threads`  | id, order_id, customer_id                                              | Chat pelanggan ↔ admin (Customer Portal)                                                                                       |
| `customer_chat_messages` | id, thread_id, sender_type (customer/admin/ai_bot), pesan, created_at  |                                                                                                                                |

**Perbedaan Audit Log vs Activity Log:**

|                      | Audit Log                                                          | Activity Log                                                     |
| -------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Tujuan               | Keamanan & forensik                                                | Histori kerja sehari-hari                                        |
| Contoh               | `user_id=12 mengubah orders.deadline dari 2026-08-01 → 2026-08-05` | "Admin A mengubah deadline order #123"                           |
| Dilihat oleh         | Developer/Owner saat investigasi                                   | Owner/Manajer saat review harian, tampil di halaman detail Order |
| Bisa diedit/dihapus? | Tidak — append-only                                                | Tidak — append-only                                              |

---

## 7. Event-Driven Architecture

Alih-alih pemanggilan langsung antar-modul (tightly coupled), MLV menggunakan **event bus** sehingga domain baru bisa "berlangganan" event tanpa mengubah domain penerbit event.

**Infrastruktur:** Redis + BullMQ sebagai message queue (cukup untuk skala MVP–menengah; bisa dinaikkan ke broker lain jika skala membesar).

### 7.1 Katalog Event Inti

| Event                              | Diterbitkan Oleh | Dikonsumsi Oleh                                                                           | Efek                        |
| ---------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- | --------------------------- |
| `OrderCreated`                     | Order            | Inventory, Notification                                                                   | Cek ketersediaan bahan awal |
| `OrderConfirmed`                   | Order            | Inventory (reservasi), Production (buat task dari routing)                                |                             |
| `PaymentSucceeded`                 | Finance          | Inventory (kunci reservasi → deduction), Order (status → Antrean), Notification           |                             |
| `PaymentFailed` / `PaymentExpired` | Finance          | Inventory (lepas reservasi), Order (status update)                                        |                             |
| `StockLow`                         | Inventory        | Notification (alert Manajer/Owner)                                                        |                             |
| `TaskCompleted`                    | Production       | Order (update progres), Notification, Production (trigger task berikutnya sesuai routing) |                             |
| `ProductionCompleted`              | Production       | Finance (terbitkan tagihan pelunasan), Notification                                       |                             |
| `InvoiceIssued`                    | Finance          | Notification                                                                              |                             |
| `ShipmentCreated`                  | Shipping         | Order (status → Dikirim), Notification                                                    |                             |
| `ApprovalRequested`                | Finance/Order    | Notification (ke Owner)                                                                   |                             |
| `ApprovalDecided`                  | Finance          | Order/Notification                                                                        |                             |

### 7.2 Contoh Alur Event: Pembayaran Sukses

```
PaymentSucceeded
   ├─▶ Inventory   : kunci reservasi jadi pengurangan stok permanen (via stock_movements)
   ├─▶ Order       : ubah status → "Antrean"
   ├─▶ Production  : generate production_tasks dari production_routings
   └─▶ Notification: kirim WA "Pembayaran diterima, pesanan masuk antrean"
```

---

## 8. Spesifikasi API (Kontrak Endpoint per Domain)

> Daftar ini adalah kontrak awal untuk AI Coding Agent — detail request/response body dijabarkan saat implementasi tiap fase, mengikuti konvensi REST + DTO Prisma.

**Identity & Access**

```
POST   /auth/login                (internal)
POST   /auth/otp/request           (pelanggan)
POST   /auth/otp/verify
POST   /auth/google/callback
GET    /auth/me
```

**Customer Domain**

```
GET    /customers/:id
PATCH  /customers/:id
GET    /customers/:id/orders
POST   /customers/:id/reviews
```

**Order Domain**

```
POST   /orders
GET    /orders
GET    /orders/:id
PATCH  /orders/:id/status
POST   /orders/:id/items
POST   /orders/:id/items/:itemId/designs
POST   /orders/:id/duplicate        (repeat order)
GET    /orders/:id/timeline
```

**Inventory Domain**

```
GET    /materials
POST   /materials
GET    /bom/:productType
POST   /stock/reserve
POST   /stock/release
POST   /stock/movements
GET    /stock/balance
POST   /purchases
POST   /stock/adjustments
```

**Production Domain**

```
GET    /production/routings/:productType
GET    /production/tasks
PATCH  /production/tasks/:id/status
POST   /production/tasks/:id/assign
```

**Finance Domain**

```
POST   /payments
POST   /payments/webhook/midtrans
GET    /invoices/:id
GET    /invoices/:id/pdf
POST   /approvals
PATCH  /approvals/:id/decide
GET    /profit-sharing
```

**Shipping Domain**

```
POST   /shipments
PATCH  /shipments/:id
GET    /shipments/:orderId/track      (publik, via token unik)
```

**Notification Domain**

```
POST   /notifications/dispatch        (internal-only, dipanggil oleh domain lain)
GET    /notifications                 (notification center)
```

**AI Domain (service terpisah `ai-gateway`)**

```
POST   /ai/design-analyzer
POST   /ai/quotation-assistant
POST   /ai/customer-support
POST   /ai/production-assistant
POST   /ai/inventory-prediction
POST   /ai/sales-insight
```

**Chat**

```
GET/POST  /orders/:id/internal-chat
GET/POST  /orders/:id/customer-chat
```

---

## 9. AI Domain — Rincian Layanan

Sesuai revisi, AI dipecah menjadi **enam layanan independen**, semuanya melewati satu backend proxy (`ai-gateway`) agar API key tetap terpusat dan aman (lihat §17).

| AI Service               | Fungsi                                                       | Dipanggil Oleh                            | Sifat                                                                        |
| ------------------------ | ------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------- |
| **Design Analyzer**      | Ekstrak spesifikasi dari catatan desain bebas teks pelanggan | Order Domain (saat checkout)              | Asistif — wajib dikonfirmasi pelanggan                                       |
| **Quotation Assistant**  | Bantu susun estimasi harga untuk kasus custom/non-standar    | Admin (Order Domain)                      | Asistif — final tetap rule engine/approval                                   |
| **Customer Support**     | Jawab pertanyaan status pesanan via WA/chat                  | Notification Domain, Customer Portal Chat | Dibatasi konteks data order aktual; eskalasi ke manusia jika di luar konteks |
| **Production Assistant** | Estimasi lead time, saran urutan task, deteksi bottleneck    | Production Domain                         | Rekomendasi, bukan otomatisasi paksa                                         |
| **Inventory Prediction** | Prediksi kebutuhan restock berdasar tren pesanan             | Inventory Domain                          | Rekomendasi ke Manajer Produksi                                              |
| **Sales Insight**        | Insight bahasa natural dari data Dashboard Analytics         | Dashboard Analytics (Owner)               | Query read-only, tidak mengubah data                                         |

Setiap service punya **prompt template terpisah** dan **endpoint terpisah** (§8) agar mudah dikembangkan/dievaluasi satu-per-satu tanpa saling mengganggu.

---

## 10. Customer Portal

| Fitur                | Deskripsi                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Riwayat Order        | Daftar semua order pelanggan + status                                                                   |
| Download Invoice     | Unduh PDF invoice DP/pelunasan                                                                          |
| Upload Revisi Desain | Menambah versi baru di `order_designs` tanpa menghapus riwayat versi lama                               |
| Chat                 | Chat langsung dengan admin per-order (`customer_chat_*`), bisa dijawab AI Customer Support atau manusia |
| Repeat Order         | Duplikasi order lama via `POST /orders/:id/duplicate`                                                   |
| Review               | Beri rating & komentar setelah order selesai (`reviews`)                                                |
| Live Tracking        | Timeline visual dari `order_timeline_events`                                                            |

---

## 11. Internal Chat

Diskusi internal per-order antara Owner, Manajer Produksi, dan Tim Penjahit (`internal_chat_threads`/`messages`) — menggantikan kebiasaan koordinasi lewat WA pribadi. Terhubung ke Notification Domain agar ada alert saat ada pesan baru.

---

## 12. Notification Center

Semua notifikasi lahir dari **event**, bukan dipanggil langsung dari kode domain lain:

```
Event Domain (mis. OrderCreated)
   → Notification Domain menerima event
   → pilih channel berdasarkan notification_templates
   → kirim ke: WA → Email → Dashboard → Push
   → catat hasil di notification_logs
```

Keuntungan: menambah channel baru (misal push notification browser) tidak memerlukan perubahan di domain penerbit event.

---

## 13. Approval Workflow

| Jenis Approval                | Diajukan Oleh    | Disetujui Oleh | Efek Setelah Disetujui                                                 |
| ----------------------------- | ---------------- | -------------- | ---------------------------------------------------------------------- |
| Harga Khusus                  | Manajer Produksi | Owner          | `order_items.base_price_snapshot` di-override, tercatat di `audit_log` |
| Diskon                        | Manajer Produksi | Owner          | Field diskon pada invoice diaktifkan                                   |
| Edit Invoice (setelah terbit) | Manajer Produksi | Owner          | Invoice lama diarsipkan, invoice baru diterbitkan                      |
| Refund                        | Manajer Produksi | Owner          | Trigger event pelepasan reservasi/stok + status order → `Dibatalkan`   |

Semua request approval memicu event `ApprovalRequested` → Notification Domain mengirim alert ke Owner secara real-time.

---

## 14. Dashboard Analytics & KPI

| Metrik                    | Domain Sumber     | Dilihat Oleh            |
| ------------------------- | ----------------- | ----------------------- |
| Omzet Bulanan             | Finance           | Owner                   |
| Order Aktif / Selesai     | Order             | Owner, Manajer Produksi |
| Profit                    | Finance           | Owner                   |
| Top Customer / Top Produk | Order, Customer   | Owner                   |
| Lead Time rata-rata       | Production        | Owner, Manajer Produksi |
| On-Time Delivery Rate     | Shipping, Order   | Owner                   |
| Repeat Customer Rate      | Customer, Order   | Owner                   |
| Conversion Rate           | Order             | Owner                   |
| Average Order Value (AOV) | Order, Finance    | Owner                   |
| Reject Rate (QC)          | Production        | Manajer Produksi        |
| Stock Accuracy            | Inventory         | Manajer Produksi        |
| Response Time CS          | Notification/Chat | Owner                   |

---

## 15. Alur Utama End-to-End (Versi Event-Driven)

1. **Registrasi/Login Pelanggan** — OTP HP atau Google (Customer Domain).
2. **Input Spesifikasi & Desain** — per `order_item` (produk bisa beragam jenis dalam satu order), kuantitas per ukuran, upload desain (Order Domain).
3. **Cek Stok Real-Time** — Order Domain memanggil Inventory Domain untuk validasi ketersediaan berdasarkan BOM.
4. **AI Design Analyzer** — hasil ekstraksi ditampilkan sebagai saran untuk dikonfirmasi pelanggan.
5. **Kalkulasi Harga** — rule engine, dibantu saran AI Quotation Assistant untuk kasus non-standar.
6. **Reservasi Stok Sementara** — `stock_reservations` dibuat saat checkout dimulai.
7. **Pembayaran DP** — memicu `PaymentSucceeded`/`PaymentFailed`.
8. **Event Cascade** — lihat §7.2: stok terkunci, order masuk Antrean, task produksi ter-generate dari routing, notifikasi terkirim.
9. **Live Tracking** — `order_timeline_events` diperbarui setiap `TaskCompleted`.
10. **Pelunasan** — dipicu otomatis oleh `ProductionCompleted`.
11. **Pengiriman** — `ShipmentCreated` setelah pelunasan terverifikasi.
12. **Customer Support Bot** — menjawab pertanyaan pelanggan berbasis data order aktual.

---

## 16. Kebutuhan Non-Fungsional

| Kategori      | Kebutuhan                                                                         |
| ------------- | --------------------------------------------------------------------------------- |
| Keamanan      | HTTPS wajib, RBAC di backend per domain, secret management terpusat               |
| Skalabilitas  | Modular monolith dengan batas domain jelas → siap dipecah microservice bila perlu |
| Reliabilitas  | Event bus tahan retry (idempotent consumer)                                       |
| Privasi Data  | Selaras UU PDP No. 27/2022 — consent, retensi, hak hapus data pelanggan           |
| Observability | Setiap domain punya health check & metrics sendiri (§22)                          |
| Auditabilitas | Audit Log + Activity Log + Approval Workflow untuk seluruh aksi sensitif          |

---

## 17. Kebutuhan Keamanan Kritis

1. **API key tidak pernah di client-side** — seluruh panggilan Gemini, Midtrans lewat backend (`ai-gateway`, `services/api`).
2. **Verifikasi signature webhook** Midtrans sebelum status pembayaran diubah.
3. **Idempotency webhook** via `webhook_event_id`.
4. **AI selalu asistif**, hasil AI Design Analyzer/Quotation Assistant wajib konfirmasi manusia sebelum final.
5. **Fallback jika AI/Event bus gagal** — alur inti (order, pembayaran) tidak boleh bergantung mutlak pada AI atau notifikasi berhasil terkirim.
6. **Row-locking saat reservasi stok** untuk mencegah race condition antar order simultan.
7. **RBAC ditegakkan di backend**, bukan hanya UI, di setiap endpoint per domain.
8. **Validasi file upload desain** (tipe, ukuran, scan dasar).
9. **Approval Workflow wajib** untuk harga khusus/diskon/edit invoice/refund — tidak bisa dilakukan langsung tanpa approval Owner.
10. **Kepatuhan UU PDP** untuk data pelanggan (consent, retensi, hak hapus).

---

## 18. Arsitektur Teknis & Tech Stack

| Layer            | Teknologi                                                               |
| ---------------- | ----------------------------------------------------------------------- |
| Monorepo Manager | **Turborepo + pnpm workspaces**                                         |
| Frontend         | Next.js + React + TypeScript + Tailwind CSS + shadcn/ui                 |
| Backend          | **NestJS** (modular per domain — lihat §18.1)                           |
| Database         | PostgreSQL + Prisma (schema disatukan di `packages/db`, lihat §19)      |
| Cache & Queue    | Redis + BullMQ (event bus, §7)                                          |
| Storage          | S3-compatible (Cloudflare R2 atau Supabase Storage)                     |
| Auth             | Auth.js (NextAuth) untuk web pelanggan, JWT + RBAC untuk API internal   |
| Payment          | Midtrans (MVP)                                                          |
| AI               | Google Gemini API, diakses lewat service `ai-gateway` terpisah          |
| Deployment       | Docker + GitHub Actions + VPS/Railway                                   |
| Observability    | Sentry (error tracking) + Grafana/Loki (opsional, saat skala bertambah) |

### 18.1 Rekomendasi: Modular Monolith untuk MVP

Untuk MVP, kami merekomendasikan **memulai sebagai modular monolith**: satu NestJS app (`services/api`) dengan modul terpisah tegas per domain (§4.1), berkomunikasi lewat _internal event emitter_ dahulu. Baru pisahkan jadi microservice sungguhan (proses/deploy terpisah, event lewat Redis/BullMQ antar proses) ketika beban salah satu domain sudah butuh scaling independen. Ini mengurangi kompleksitas operasional di awal tanpa mengorbankan batas domain yang sudah didesain rapi.

Penerapan `services/*` di §19 **tidak seragam** — dua alasan berbeda menentukan mana yang berdiri sendiri sejak Fase 0 dan mana yang belum:

| Service                 | Status di Fase 0–2                                                                                                                                        | Alasan                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/api`          | Aktif — berisi modul Customer, Order, **Inventory**, Production, Finance, Shipping                                                                        | Domain-domain ini digabung dulu sebagai modular monolith; pemisahannya murni batas _kode_ (folder modul), bukan batas proses                                      |
| `services/inventory`    | **Placeholder saja** (`README.md` berisi rencana ekstraksi masa depan) — logic Inventory Domain untuk sementara ada sebagai modul di dalam `services/api` | Alasan pemisahan modular monolith di atas berlaku persis untuk domain ini — belum ada kebutuhan proses/deploy terpisah                                            |
| `services/notification` | Aktif sejak Fase 0 — worker BullMQ terpisah                                                                                                               | Ini bukan soal batas domain, tapi **jenis proses yang berbeda**: consumer/worker asinkron, bukan HTTP API. Sudah wajar berjalan sebagai proses sendiri sejak awal |
| `services/ai-gateway`   | Aktif sejak Fase 0                                                                                                                                        | Alasan **keamanan** (§17.1): harus jadi satu-satunya pemegang Gemini API key, terisolasi dari service lain, bukan soal beban/skala                                |

Domain Inventory boleh "naik kelas" jadi service NestJS aktif di `services/inventory` kapan pun beban/skalanya membutuhkan — cukup pindahkan modul dari `services/api` tanpa mengubah kontrak API di §8, karena batas domainnya memang sudah didesain rapi sejak awal.

---

## 19. Struktur Folder (Monorepo)

```
mlv/
├── apps/
│   ├── web/                 # Next.js — website publik & Customer Portal
│   └── admin/                # Next.js — portal internal (Owner/Manajer/Penjahit)
├── packages/
│   ├── ui/                    # shared shadcn/ui component library
│   ├── auth/                  # Auth.js config, RBAC middleware, JWT utils
│   ├── db/                     # SATU-SATUNYA lokasi Prisma: schema.prisma + generated client,
│   │                           # diekspor sebagai package internal ke apps/ & services/*
│   ├── ai/                     # Gemini client wrapper, prompt templates per AI service
│   └── types/                   # shared TypeScript types/DTO antar apps & services
├── services/
│   ├── api/                     # NestJS — modular monolith: Customer, Order, Inventory,
│   │                             # Production, Finance, Shipping domains (lihat §18.1)
│   ├── inventory/                # PLACEHOLDER Fase 0-2 — hanya README.md rencana ekstraksi.
│   │                             # Logic Inventory Domain sementara ada di services/api (§18.1)
│   ├── notification/              # Worker BullMQ — konsumsi event, dispatch multi-channel
│   └── ai-gateway/                 # AI Domain — 6 service AI, satu-satunya pemegang Gemini API key
├── docker/
├── turbo.json                # konfigurasi Turborepo
├── pnpm-workspace.yaml        # daftar workspace pnpm
├── .github/workflows/
└── docs/
    └── prd.md
```

> **Catatan:** tidak ada folder `prisma/` terpisah di root — ini menggantikan penyebutan di draft sebelumnya yang tumpang tindih dengan `packages/db`. Semua hal terkait Prisma (schema, migration, generated client) hidup di `packages/db`.

---

## 20. Strategi Testing

| Jenis Test                               | Cakupan                                                                            | Target                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Unit Test**                            | Business logic per domain (use-case/service layer)                                 | ≥ 80% coverage untuk Order, Inventory, Finance (domain kritis); ≥ 60% domain lain |
| **Integration Test**                     | Endpoint API + interaksi database per domain, alur webhook payment (sandbox)       | Semua endpoint di §8 punya minimal 1 test happy-path + 1 test error-path          |
| **End-to-End Test** (Playwright/Cypress) | Alur kritis: pesan → bayar sandbox → tracking; login RBAC per role                 | Seluruh alur §15 lulus di staging sebelum go-live                                 |
| **Performance Test** (k6/Artillery)      | Endpoint reservasi stok & pembuatan order saat concurrent request                  | Tidak ada overselling stok di bawah beban paralel                                 |
| **Security Test**                        | RBAC bypass attempt, tampering signature webhook, dependency scan (npm audit/Snyk) | Nol temuan kritis sebelum go-live                                                 |

---

## 21. Deployment & CI/CD

```
GitHub (push/PR)
   → GitHub Actions: lint → unit test → build
   → Build Docker image per service
   → Push ke container registry
   → Deploy ke Railway/VPS
   → Migrasi Prisma otomatis
   → PostgreSQL (managed/self-hosted) + Object Storage (R2/Supabase)
   → Smoke test pasca-deploy
```

---

## 22. Monitoring & Observability

| Aspek            | Tools/Metode                                               |
| ---------------- | ---------------------------------------------------------- |
| Health Check     | Endpoint `/health` di setiap service                       |
| Error Tracking   | Sentry                                                     |
| Performance      | Grafana + Loki (opsional, aktifkan saat traffic bertambah) |
| Audit            | Dashboard view dari `audit_log`                            |
| API Metrics      | Request count, latency, error rate per endpoint domain     |
| Database Metrics | Connection pool, slow query log                            |
| Queue Metrics    | BullMQ job success/failure/retry (Bull Board)              |

---

## 23. Roadmap Implementasi Bertahap

> Setiap fase = satu unit kerja yang bisa dikerjakan penuh oleh AI Coding Agent sebelum lanjut ke fase berikutnya.

| Fase   | Fokus                                                                                      | Kriteria Selesai                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **0**  | Monorepo, Docker, CI skeleton, Prisma init                                                 | Project jalan lokal, tidak ada secret hardcode                                                                                   |
| **1**  | Identity & Access + Customer Domain                                                        | RBAC internal & auth pelanggan (OTP/Google) berfungsi, dicek di backend                                                          |
| **2**  | Inventory Domain fondasi (Material, Warehouse, BOM, Stock, Movement, Purchase, Adjustment) | Semua perubahan stok tercatat lewat `stock_movements`, tidak ada update langsung ke balance                                      |
| **3**  | Order Domain (orders slim + items/sizes/designs/materials/services)                        | Order menghitung kebutuhan bahan otomatis dari BOM, bukan input manual                                                           |
| **4**  | Production Domain (routing + tasks granular)                                               | `OrderConfirmed` otomatis membuat rangkaian `production_tasks` sesuai routing produk                                             |
| **5**  | Finance Domain (payments, invoices, approvals, profit sharing)                             | Approval Workflow aktif untuk harga khusus/diskon/edit invoice/refund                                                            |
| **6**  | Event-Driven Integration Layer (Redis + BullMQ, katalog event §7)                          | Event `PaymentSucceeded` terbukti memicu cascade ke Inventory/Order/Production/Notification tanpa panggilan langsung antar modul |
| **7**  | Shipping Domain                                                                            | Status pengiriman terhubung ke event pelunasan                                                                                   |
| **8**  | Notification Domain (multi-channel + center)                                               | Menambah channel baru tidak mengubah kode domain penerbit event                                                                  |
| **9**  | Portal Internal lengkap (Dashboard, semua modul + Activity Log + Internal Chat)            | RBAC per §5.1 terverifikasi di UI dan API                                                                                        |
| **10** | Website Publik & Customer Portal                                                           | Riwayat, invoice download, upload revisi, chat, repeat order, review berfungsi                                                   |
| **11** | Integrasi Payment Gateway (Midtrans) + reservasi stok otomatis                             | Sandbox payment memicu event chain yang benar; reservasi kadaluarsa otomatis lepas                                               |
| **12** | AI Domain — mulai dari Design Analyzer, lalu 5 service lain bertahap                       | Setiap AI service independen, punya endpoint & prompt template sendiri; fallback manual jika AI gagal                            |
| **13** | Dashboard Analytics & KPI                                                                  | Seluruh metrik §14 terhitung dari data domain terkait, real-time/near-real-time                                                  |
| **14** | Testing Strategy (unit/integration/e2e/performance/security)                               | Target coverage §20 terpenuhi                                                                                                    |
| **15** | Deployment & CI/CD                                                                         | Pipeline §21 berjalan otomatis dari push ke deploy                                                                               |
| **16** | Monitoring & Observability                                                                 | Seluruh item §22 aktif di production                                                                                             |
| **17** | Hardening Keamanan, Audit Compliance & Go-Live                                             | Checklist §17 terpenuhi seluruhnya dan terdokumentasi                                                                            |

---

## 24. Risiko & Mitigasi

| Risiko                                         | Mitigasi                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Domain saling coupling erat (anti-pattern DDD) | Aturan tegas §4.1: tidak ada query lintas domain langsung, hanya via event/API |
| Stok habis setelah DP dibayar                  | Reservasi via `stock_reservations` + row-locking (§17.6)                       |
| AI salah baca spesifikasi desain               | AI selalu asistif, wajib konfirmasi manusia (§9, §17.4)                        |
| Event hilang/gagal diproses                    | Idempotent consumer + retry BullMQ, monitoring queue (§22)                     |
| Approval disalahgunakan/dilewati               | Approval Workflow wajib di level API, bukan hanya UI (§13, §17.9)              |
| Kompleksitas microservice sejak awal           | Mulai sebagai modular monolith (§18.1), pisah bertahap sesuai kebutuhan skala  |
| Data pelanggan bocor/disalahgunakan            | Kepatuhan UU PDP, consent, enkripsi data sensitif (§17.10)                     |

---

## 25. Lampiran

### 25.1 Status Order

`Draft` → `Menunggu Pembayaran DP` → `Antrean` → _(mengikuti `production_routings` produk: Cutting → Printing/Embroidery → Sewing → Finishing → Ironing → Packing)_ → `Selesai` → `Menunggu Pelunasan` → `Lunas` → `Dikirim`
_(alternatif: `Dibatalkan` dari status manapun sebelum "Dikirim")_

### 25.2 Contoh BOM — Kaos

| Material        | Qty per Unit |
| --------------- | ------------ |
| Kain            | 2.3 meter    |
| Label           | 1 pcs        |
| Plastik Kemasan | 1 pcs        |
| Hangtag         | 1 pcs        |
| Benang          | 0.3 cone     |

### 25.3 Glossary Domain

- **BOM (Bill of Materials):** daftar bahan baku yang dibutuhkan per unit produk.
- **Routing:** urutan proses produksi yang dibutuhkan per jenis produk.
- **Bounded Context:** batas tanggung jawab satu domain dalam DDD.
- **Event Bus:** mekanisme domain saling memberi tahu tanpa saling memanggil langsung.
- **Modular Monolith:** satu aplikasi dengan modul-modul yang batasnya setegas microservice, tapi berjalan dalam satu proses/deployment.

---

_Dokumen ini adalah living document. Perbarui setiap fase implementasi selesai, terutama saat keputusan teknis final diambil (mis. kapan modular monolith dipecah jadi microservice sungguhan)._
