---
trigger: always_on
---

Dokumen acuan utama Anda adalah `prd.md` di root folder ini (\MLV\docs). Ini adalah SATU-SATUNYA sumber kebenaran untuk arsitektur, model data, kontrak API, tech stack, dan urutan fase implementasi. Baca dokumen itu secara menyeluruh sebelum menulis kode apa pun.

ATURAN KERJA WAJIB:

1. KERJAKAN SATU FASE PADA SATU WAKTU, sesuai urutan di §23 PRD (Fase 0 sampai Fase 17). Jangan melompat ke fase berikutnya atau menulis kode untuk domain di luar fase yang sedang berjalan, meskipun tergoda karena "sudah kelihatan perlu". Jika Anda melihat dependensi ke fase lain, catat saja sebagai TODO.

2. SEBELUM MENULIS KODE untuk suatu fase, tuliskan dulu:
   - Ringkasan pemahaman Anda soal scope fase tersebut (dari §23 + bagian PRD yang relevan).
   - Task breakdown singkat (checklist).
   - Pertanyaan klarifikasi jika ada bagian PRD yang ambigu untuk fase ini. Tunggu konfirmasi saya sebelum lanjut menulis kode, KECUALI saya sudah bilang "lanjut tanpa konfirmasi tiap fase".

3. IKUTI PRINSIP ARSITEKTUR DI PRD SECARA KETAT:
   - Domain-Driven Design sesuai §4 — jangan ada domain yang query langsung ke tabel domain lain, harus lewat event atau API/service call.
   - Mulai sebagai modular monolith sesuai §18.1 (satu NestJS app, modul per domain), bukan microservice terpisah sejak awal.
   - Struktur folder harus mengikuti §19 persis.
   - Model data mengikuti §6 persis, termasuk prinsip "orders" tetap ramping dan stok HANYA berubah lewat stock_movements (§6.4).

4. KEAMANAN NON-NEGOTIABLE (§17):
   - JANGAN PERNAH menulis API key atau secret apa pun langsung di kode. Semua lewat environment variable. Buat file `.env.example` berisi nama variabel yang dibutuhkan (tanpa nilai asli) setiap kali menambah integrasi baru.
   - Semua endpoint API wajib mengecek role/permission di backend (§5.1), jangan hanya di UI.
   - Ikuti checklist keamanan §17 untuk setiap fase yang relevan.

5. BUAT DAN JAGA FILE `AGENT_PROGRESS.md` DI ROOT FOLDER:
   - Setiap fase selesai, tambahkan entri: fase ke berapa, tanggal, ringkasan yang sudah dibuat, keputusan teknis yang diambil (jika PRD memberi pilihan), dan apa yang masih tertunda.
   - File ini WAJIB dibaca di awal setiap sesi baru sebelum melanjutkan pekerjaan — ini adalah memori agent lintas sesi. Jika ada perbedaan keputusan teknis antara AGENT_PROGRESS.md dan dokumen rencana awal, ikuti yang tertulis di AGENT_PROGRESS.md karena itu keputusan final yang sudah dieksekusi di kode.
   - Gunakan format entri konsisten per fase (tabel: Fase | Tanggal | Ringkasan | Keputusan Teknis | Pending) — bukan paragraf bebas, supaya gampang diproses agent di sesi berikutnya.
   - Tambahkan aturan: kalau ada perbedaan antara AGENT_PROGRESS.md dan dokumen rencana/prompt awal soal keputusan teknis (mis. versi library), yang di AGENT_PROGRESS.md yang harus diikuti — karena itu representasi keputusan final yang sudah benar-benar dieksekusi di kode, bukan rencana.

6. GIT WORKFLOW:
   - Commit per unit kerja yang bermakna (bukan satu commit raksasa per fase).
   - Format pesan commit: `[Fase X][Domain] deskripsi singkat` Contoh: `[Fase 2][Inventory] tambah model Material, BOM, dan Warehouse`

7. TESTING:
   - Ikuti target coverage dan jenis test di §20 PRD sesuai fase yang relevan. Domain kritis (Order, Inventory, Finance) tidak boleh tanpa unit test.
