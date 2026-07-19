/**
 * Quotation Assistant Prompt Template (Fase 12 Bagian 2)
 *
 * §17.4, §17.5: AI HANYA memberi saran harga, tidak pernah auto-apply.
 * Harga final selalu di-input manusia lewat Approval "Harga Khusus" (Fase 5).
 *
 * Input: product type, qty, kompleksitas (dari Design Analyzer kalau ada),
 *        catatan dari staf (mis. "bahan premium", "warna custom").
 * Output: range harga per-pcs (low/high) + total estimasi + alasan singkat.
 */

export interface QuotationAssistantInput {
  /** Tipe produk (Kaos, Kemeja, Hoodie, Topi, Tas) */
  productType: string;
  /** Total quantity (jumlah pcs yang dipesan) */
  qty: number;
  /**
   * Kompleksitas desain dari Design Analyzer (Fase 12 Bagian 1) — optional.
   * 'RENDAH' | 'SEDANG' | 'TINGGI' | null
   */
  complexity?: 'RENDAH' | 'SEDANG' | 'TINGGI' | null;
  /** Hasil analisis desain dari Design Analyzer (optional) */
  designSummary?: string | null;
  /** Catatan dari staf (mis. "bahan cotton combed 30s, sablon 4 warna") */
  catatanStaf?: string;
  /**
   * Harga dasar standar dari ProductPriceList — optional.
   * AI akan memberi saran sekitar nilai ini untuk referensi.
   */
  basePriceReference?: number;
}

/**
 * Build the system prompt for quotation assistance.
 *
 * Aturan utama (§17.4): AI HANYA menyarankan, tidak menentukan harga final.
 */
export function buildQuotationSystemPrompt(): string {
  return `Kamu adalah asisten quotation untuk usaha konveksi garment. Tugas kamu memberi SARAN RANGE HARGA (low - high) per pcs dan total estimasi untuk staf MLV.

ATURAN KETAT:
- Kamu HANYA memberi saran. Harga final selalu ditentukan manusia lewat approval workflow.
- Range harga realistis untuk konveksi skala kecil-menengah di Indonesia (Jabodetabek).
- Untuk quantity kecil (< 10 pcs), harga per pcs lebih tinggi karena ada biaya setup.
- Kompleksitas desain mempengaruhi harga:
  * RENDAH = 1-2 warna, desain simpel, sablon biasa
  * SEDANG = 3-5 warna, beberapa lokasi, atau bordir
  * TINGGI = banyak warna, detail rumit, banyak lokasi, atau teknik khusus (sublimasi, DTG)
- Layanan tambahan (sablon/bordir) menambah biaya per pcs.
- Bahan premium (cotton combed 30s, fleece) lebih mahal dari bahan standar.
- Berikan alasan singkat (1-3 kalimat) kenapa range ini sesuai.

Kembalikan HANYA dalam format JSON yang valid (tanpa markdown code block):

{
  "harga_per_pcs": {
    "low": <number>,
    "high": <number>
  },
  "total_estimasi": {
    "low": <number>,
    "high": <number>
  },
  "alasan": "alasan singkat kenapa range ini sesuai (1-3 kalimat)",
  "faktor_pendorong_harga": ["faktor 1", "faktor 2"],
  "saran_untuk_staf": "saran tambahan (optional, mis. 'pertimbangkan approval harga khusus')"
}

Penting:
- harga_per_pcs.low SELALU <= harga_per_pcs.high
- total_estimasi = harga_per_pcs × qty
- Gunakan bahasa Indonesia yang profesional
- Jika catatan staf menyebutkan hal spesifik (bahan, teknik), pertimbangkan itu`;
}

/**
 * Build the user prompt for quotation assistance.
 */
export function buildQuotationUserPrompt(input: QuotationAssistantInput): string {
  const { productType, qty, complexity, designSummary, catatanStaf, basePriceReference } = input;

  let prompt = `Minta saran harga untuk order berikut:\n\n`;
  prompt += `Produk: ${productType}\n`;
  prompt += `Quantity: ${qty} pcs\n`;

  if (complexity) {
    prompt += `Kompleksitas desain: ${complexity}\n`;
  } else {
    prompt += `Kompleksitas desain: tidak dianalisis (asumsikan SEDANG)\n`;
  }

  if (designSummary) {
    prompt += `Ringkasan desain: ${designSummary}\n`;
  }

  if (catatanStaf) {
    prompt += `Catatan staf: ${catatanStaf}\n`;
  }

  if (basePriceReference) {
    prompt += `Harga dasar standar (ProductPriceList): Rp ${basePriceReference.toLocaleString('id-ID')} per pcs\n`;
  }

  prompt += `\nBerikan saran range harga per pcs dan total estimasi.`;

  return prompt;
}
