# services/inventory — Placeholder

> **Status: PLACEHOLDER** — tidak ada kode NestJS aktif di folder ini.

## Kenapa folder ini ada tapi kosong?

Sesuai §18.1 PRD (Modular Monolith), logic Inventory Domain untuk sementara hidup sebagai **modul di dalam `services/api`** (bukan service terpisah). Ini karena:

1. Belum ada kebutuhan proses/deploy terpisah untuk Inventory.
2. Sebagai modular monolith, semua domain dijalankan dalam satu proses NestJS untuk mengurangi kompleksitas operasional di awal.
3. Batas domain tetap dijaga ketat di level kode (folder modul terpisah, tidak ada query lintas domain langsung).

## Kapan folder ini jadi service aktif?

Folder ini disiapkan untuk **ekstraksi di masa depan**: ketika beban atau kebutuhan scaling Inventory Domain membutuhkan proses/deploy terpisah, modul Inventory dipindahkan dari `services/api` ke sini tanpa mengubah kontrak API (§8).

## Referensi PRD

- §18.1 — Rekomendasi Modular Monolith
- §19 — Struktur Folder
- §23 — Roadmap (Fase 0–2: placeholder)
