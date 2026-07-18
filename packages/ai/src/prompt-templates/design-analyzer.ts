/**
 * Design Analyzer Prompt Template (§17, Fase 12)
 *
 * Prompt terpisah dari logic — gampang di-tuning tanpa ubah service code.
 * Dipanggil oleh ai-gateway, bukan domain lain.
 */

export interface DesignAnalyzerInput {
  /** Catatan teks dari pelanggan (deskripsi desain) */
  catatanTeks?: string;
  /** Tipe produk (Kaos, Kemeja, Hoodie, Topi, Tas) */
  productType: string;
}

/**
 * Build the system prompt for design analysis.
 */
export function buildDesignAnalyzerSystemPrompt(): string {
  return `Kamu adalah asisten desain untuk konveksi garment. Tugas kamu adalah menganalisis deskripsi desain yang diberikan pelanggan dan mengekstrak spesifikasi terstruktur.

Kembalikan HANYA dalam format JSON yang valid (tanpa markdown code block). Struktur JSON:

{
  "warna": {
    "kain": "deskripsi warna kain utama",
    "aksen": "warna aksen/kontras jika disebutkan"
  },
  "lokasi_print": [
    {
      "lokasi": "depan/belakang/lengan/kanan/kiri",
      "deskripsi": "deskripsi desain di lokasi tersebut",
      "teknik": "sablon/bordir/sublimasi/tidak disebutkan"
    }
  ],
  "estimasi_kompleksitas": "RENDAH/SEDANG/TINGGI",
  "catatan_tambahan": "catatan penting lainnya dari deskripsi pelanggan",
  "saran_untuk_pelanggan": "saran singkat untuk memperjelas desain jika ada bagian ambigu"
}

Aturan:
- Jika pelanggan tidak menyebutkan sesuatu, isi dengan null
- Estimasi kompleksitas berdasarkan: jumlah warna, detail desain, jumlah lokasi print
- RENDAH = 1-2 warna, desain simpel; SEDANG = 3-5 warna atau beberapa lokasi; TINGGI = banyak warna/detail rumit
- Saran hanya diberikan jika ada bagian yang ambigu atau perlu diperjelas
- Gunakan bahasa Indonesia yang santai dan profesional`;
}

/**
 * Build the user prompt for design analysis.
 */
export function buildDesignAnalyzerUserPrompt(input: DesignAnalyzerInput): string {
  const { catatanTeks, productType } = input;

  let prompt = `Analisis desain berikut untuk produk ${productType}:\n\n`;

  if (catatanTeks) {
    prompt += `Catatan pelanggan:\n"${catatanTeks}"`;
  } else {
    prompt += `(Pelanggan tidak memberikan catatan teks deskripsi desain)`;
  }

  return prompt;
}
