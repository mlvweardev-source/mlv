/**
 * Production Assistant Prompt Template (Fase 12 Bagian 3, §9)
 *
 * Menerima state task produksi dari ProductionService, Gemini kasih:
 * - Estimasi lead time order
 * - Saran urutan task kalau bisa dioptimasi
 * - Deteksi bottleneck (tahap mana yang task-nya menumpuk)
 *
 * §9: Rekomendasi, bukan otomatisasi paksa — tidak pernah auto-reorder
 * task atau ubah assignment, cuma saran ditampilkan ke staf.
 */

export interface ProductionAssistantInput {
  /** Order number untuk konteks */
  orderNumber: string;
  /** Status order saat ini */
  orderStatus: string;
  /** Daftar task produksi dengan detail */
  tasks: Array<{
    taskType: string;
    sequence: number;
    status: string;
    assignedToNama: string | null;
    productType: string;
    startedAt: string | null;
  }>;
  /** Jumlah task per tahap (untuk deteksi bottleneck) */
  taskCountByStage: Record<string, { total: number; active: number; waiting: number }>;
}

/**
 * Build the system prompt for production assistant.
 *
 * Aturan §9: AI HANYA memberi saran — tidak pernah auto-reorder task
 * atau mengubah assignment. Staf yang putuskan tindak lanjut.
 */
export function buildProductionAssistantSystemPrompt(): string {
  return `Kamu adalah asisten produksi untuk konveksi garment. Tugas kamu menganalisis state task produksi dan memberikan insight kepada Manajer Produksi.

ATURAN KETAT:
1. Kamu HANYA memberi saran dan rekomendasi. TIDAK PERNAH menyuruh sistem mengubah task secara otomatis.
2. Deteksi bottleneck: tahap dengan jumlah task MENUNGGU/TERIMA yang tinggi dibanding tahap lain = potensi bottleneck.
3. Saran urutan: kalau ada task yang bisa diprioritaskan (mis. order deadline dekat, task sudah menunggu lama), sarankan.
4. Estimasi lead time: berdasarkan jumlah task aktif dan kompleksitas, berikan estimasi kasar kapan order bisa selesai.
5. Gunakan bahasa Indonesia yang profesional dan singkat.

Kembalikan HANYA dalam format JSON yang valid (tanpa markdown code block):

{
  "estimasi_lead_time": "estimasi kasar (mis. '2-3 hari kerja', '1 minggu')",
  "bottleneck": {
    "terdeteksi": true/false,
    "tahap": "nama tahap yang bottleneck (null jika tidak ada)",
    "alasan": "kenapa ini bottleneck",
    "jumlah_task_menumpuk": <number>
  },
  "saran_urutan": [
    {
      "prioritas": "TINGGI/SEDANG/RENDAH",
      "tahap": "tahap terkait",
      "saran": "deskripsi saran",
      "alasan": "kenapa ini perlu diprioritaskan"
    }
  ],
  "ringkasan": "ringkasan singkat kondisi produksi saat ini (1-3 kalimat)"
}

Penting:
- Jika tidak ada bottleneck, bottleneck.terdeteksi = false dan field lain null/kosong
- Saran urutan bisa kosong array jika tidak ada yang perlu diprioritaskan
- Estimasi lead time harus realistis untuk konveksi skala kecil-menengah`;
}

/**
 * Build the user prompt for production assistant.
 */
export function buildProductionAssistantUserPrompt(input: ProductionAssistantInput): string {
  let prompt = `Analisis kondisi produksi untuk order ${input.orderNumber}:\n\n`;
  prompt += `Status order: ${input.orderStatus}\n\n`;

  prompt += `Jumlah task per tahap:\n`;
  for (const [stage, counts] of Object.entries(input.taskCountByStage)) {
    prompt += `- ${stage}: ${counts.total} total (${counts.active} aktif, ${counts.waiting} menunggu)\n`;
  }
  prompt += `\n`;

  if (input.tasks.length > 0) {
    prompt += `Detail task:\n`;
    for (const task of input.tasks) {
      const assignee = task.assignedToNama ?? 'belum ditugaskan';
      const started = task.startedAt
        ? ` (mulai: ${new Date(task.startedAt).toLocaleDateString('id-ID')})`
        : '';
      prompt += `- [${task.taskType}] urutan ${task.sequence}, status: ${task.status}, assignee: ${assignee}${started}, produk: ${task.productType}\n`;
    }
    prompt += `\n`;
  }

  prompt += `Berikan analisis: deteksi bottleneck, saran urutan prioritas, dan estimasi lead time.`;

  return prompt;
}
