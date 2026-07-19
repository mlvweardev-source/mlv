/**
 * Inventory Prediction Prompt Template (Fase 12 Bagian 3, §9)
 *
 * Menerima data stok saat ini + tren pemakaian material dari histori order,
 * Gemini kasih prediksi kebutuhan restock:
 * - Material mana yang bakal menipis
 * - Estimasi kapan
 * - Saran qty beli
 *
 * §9: Rekomendasi ke Manajer Produksi — tidak pernah auto-buat Purchase Order.
 */

export interface InventoryPredictionInput {
  /** Stok saat ini per material */
  stockBalances: Array<{
    materialNama: string;
    materialId: string;
    satuan: string;
    qtyAvailable: number;
    qtyReserved: number;
    freeStock: number;
  }>;
  /** Tren pemakaian material (dari histori order N hari terakhir) */
  usageTrends: Array<{
    materialNama: string;
    materialId: string;
    totalUsed: number;
    periodeHari: number;
    avgPerDay: number;
  }>;
  /** Jumlah order aktif (dalam produksi / antrean) */
  activeOrderCount: number;
  /** BOM yang relevan (material per product type) */
  bomSummary: Array<{
    productType: string;
    materials: Array<{ materialNama: string; qtyPerUnit: number; satuan: string }>;
  }>;
}

/**
 * Build the system prompt for inventory prediction.
 *
 * Aturan §9: AI HANYA memberi saran restock — tidak pernah auto-create
 * Purchase Order. Staf yang putuskan dan submit PO lewat UI yang sudah ada.
 */
export function buildInventoryPredictionSystemPrompt(): string {
  return `Kamu adalah asisten inventory untuk konveksi garment. Tugas kamu menganalisis tren pemakaian material dan memprediksi kebutuhan restock.

ATURAN KETAT:
1. Kamu HANYA memberi saran restock. TIDAK PERNAH menyuruh sistem membuat Purchase Order otomatis.
2. Prediksi berdasarkan tren pemakaian aktual dari histori order, BUKAN tebakan.
3. Perhitungkan stok saat ini (qty_available - qty_reserved = free stock) dan laju konsumsi rata-rata.
4. Material dengan free stock mendekati 0 atau di bawah batas aman (5 unit) = PRIORITAS TINGGI.
5. Estimasi kapan stok habis = free stock / avg_per_day (dalam hari).
6. Saran qty beli = cukup untuk 2-4 minggu ke depan (buffer aman).
7. Gunakan bahasa Indonesia yang profesional.

Kembalikan HANYA dalam format JSON yang valid (tanpa markdown code block):

{
  "prediksi": [
    {
      "materialNama": "nama material",
      "materialId": "id material",
      "status": "KRITIS/RENDAH/AMAN",
      "stok_saat_ini": <number>,
      "free_stock": <number>,
      "avg_per_day": <number>,
      "estimasi_habis_hari": <number>,
      "saran_qty_beli": <number>,
      "satuan": "satuan material",
      "alasan": "alasan singkat prediksi ini"
    }
  ],
  "ringkasan": "ringkasan kondisi inventory (1-3 kalimat)",
  "rekomendasi_umum": "saran umum untuk manajer produksi (1-2 kalimat)"
}

Klasifikasi status:
- KRITIS: free_stock <= 5 ATAU estimasi_habis_hari <= 3
- RENDAH: free_stock <= 20 ATAU estimasi_habis_hari <= 14
- AMAN: sisanya

Penting:
- Jika semua material aman, tetap tampilkan prediksi dengan status AMAN
- estimasi_habis_hari bisa "Infinity" jika avg_per_day = 0 (tidak ada tren pemakaian)
- saran_qty_beli = 0 jika stok masih aman`;
}

/**
 * Build the user prompt for inventory prediction.
 */
export function buildInventoryPredictionUserPrompt(input: InventoryPredictionInput): string {
  let prompt = `Analisis kondisi inventory saat ini:\n\n`;

  prompt += `Jumlah order aktif: ${input.activeOrderCount}\n\n`;

  if (input.stockBalances.length > 0) {
    prompt += `Stok saat ini:\n`;
    for (const stock of input.stockBalances) {
      prompt += `- ${stock.materialNama}: tersedia ${stock.qtyAvailable} ${stock.satuan}, direservasi ${stock.qtyReserved}, bebas ${stock.freeStock}\n`;
    }
    prompt += `\n`;
  }

  if (input.usageTrends.length > 0) {
    prompt += `Tren pemakaian (${input.usageTrends[0]?.periodeHari ?? 30} hari terakhir):\n`;
    for (const trend of input.usageTrends) {
      prompt += `- ${trend.materialNama}: total terpakai ${trend.totalUsed}, rata-rata ${trend.avgPerDay.toFixed(2)}/hari\n`;
    }
    prompt += `\n`;
  }

  if (input.bomSummary.length > 0) {
    prompt += `Bill of Materials (BOM):\n`;
    for (const bom of input.bomSummary) {
      prompt += `- ${bom.productType}: ${bom.materials.map((m) => `${m.materialNama} (${m.qtyPerUnit} ${m.satuan}/pcs)`).join(', ')}\n`;
    }
    prompt += `\n`;
  }

  prompt += `Berikan prediksi: material mana yang perlu direstock, estimasi kapan habis, dan saran quantity beli.`;

  return prompt;
}
