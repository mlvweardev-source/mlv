/**
 * Customer Support Prompt Template (Fase 12 Bagian 2)
 *
 * §9: AI Customer Support HANYA menjawab dari konteks data order aktual.
 * Pertanyaan di luar konteks = escalate, JANGAN menebak/berhalusinasi.
 *
 * Auto-reply aman untuk pertanyaan yang bisa dijawab dari data order:
 * - "Kapan pesanan saya selesai?" → status + timeline
 * - "Sudah dibayar?" → payment status
 * - "Kapan dikirim?" → shipment info
 * - "Berapa total tagihan?" → invoice amount
 *
 * WAJIB escalate untuk hal di luar data order:
 * - Permintaan diskon / negosiasi harga
 * - Komplain / kompensasi
 * - Perubahan desain / perubahan spesifikasi
 * - Pertanyaan tentang proses / kebijakan yang tidak ada di data
 */

export interface CustomerSupportInput {
  /** Pertanyaan asli dari pelanggan */
  pertanyaan: string;
  /**
   * Konteks order yang sudah dikumpulkan services/api (Fase 8 prinsip:
   * ai-gateway TIDAK query balik, semua data ditaruh di sini).
   */
  orderContext: {
    orderNumber: string;
    status: string;
    items: Array<{
      productType: string;
      qty: number;
      basePriceSnapshot: number;
    }>;
    timeline: Array<{
      tipeEvent: string;
      deskripsi: string;
      createdAt: string;
    }>;
    payments: Array<{
      jenis: 'DP' | 'PELUNASAN';
      jumlah: number;
      status: string;
      createdAt: string;
    }>;
    invoices: Array<{
      jenis: 'DP' | 'PELUNASAN';
      jumlah: number;
      status: string;
    }>;
    shipment: {
      kurir: string;
      noResi: string | null;
      status: string;
      shippedAt: string | null;
      deliveredAt: string | null;
    } | null;
  };
}

/**
 * Build the system prompt for customer support.
 *
 * Aturan §9: AI HANYA jawab dari konteks order yang diberikan. Tidak menebak.
 * Jika pertanyaan di luar konteks, return canAnswer=false.
 */
export function buildCustomerSupportSystemPrompt(): string {
  return `Kamu adalah asisten customer support untuk MLV Konveksi. Tugas kamu menjawab pertanyaan pelanggan tentang order mereka.

ATURAN KETAT (Fase 12 §9):
1. Kamu HANYA boleh menjawab berdasarkan KONTEKS ORDER yang diberikan di bawah.
2. Jika pertanyaan TIDAK bisa dijawab dari konteks (mis. minta diskon, komplain, negosiasi, perubahan spesifikasi), return canAnswer=false dengan alasan kenapa harus eskalasi ke manusia.
3. JANGAN PERNAH mengarang jawaban, menebak nomor resi, tanggal, atau status yang tidak ada di konteks.
4. JANGAN menjanjikan diskon, refund, atau perubahan harga — itu kebijakan staf MLV.
5. Gunakan bahasa Indonesia yang sopan, singkat, dan jelas.
6. Jika order belum LUNAS, jangan jawab pertanyaan terkait pengiriman secara detail (no resi, kurir) karena bisa berubah.
7. Jika order sudah DIKIRIM, berikan info no resi dan kurir dari konteks.

Kembalikan HANYA dalam format JSON yang valid (tanpa markdown code block):

{
  "canAnswer": true/false,
  "jawaban": "jawaban untuk pelanggan (kosong jika canAnswer=false)",
  "alasan_eskalasi": "jika canAnswer=false, jelaskan kenapa perlu staf (kosong jika canAnswer=true)"
}

Contoh pertanyaan yang HARUS di-eskalasi (canAnswer=false):
- "Bisa dapat diskon?"
- "Kenapa harga segini mah?"
- "Saya mau revisi desain"
- "Tambah qty jadi 100"
- "Komplain, hasil jelek"
- Pertanyaan apapun yang tidak bisa dijawab dari data order yang diberikan

Contoh pertanyaan yang BISA dijawab (canAnswer=true):
- "Kapan pesanan saya selesai?" → jawab dari status + timeline
- "Sudah dibayar belum DP-nya?" → jawab dari payment status
- "Kapan dikirim?" → jawab dari shipment info (jika status LUNAS/DIKIRIM)
- "Berapa total tagihan?" → jawab dari invoice`;
}

/**
 * Build the user prompt for customer support with order context.
 */
export function buildCustomerSupportUserPrompt(input: CustomerSupportInput): string {
  const { pertanyaan, orderContext } = input;

  let prompt = `KONTEKS ORDER:\n`;
  prompt += `Nomor order: ${orderContext.orderNumber}\n`;
  prompt += `Status: ${orderContext.status}\n\n`;

  if (orderContext.items.length > 0) {
    prompt += `Item:\n`;
    for (const item of orderContext.items) {
      prompt += `- ${item.productType}: ${item.qty} pcs @ Rp ${item.basePriceSnapshot.toLocaleString('id-ID')}\n`;
    }
    prompt += `\n`;
  }

  if (orderContext.timeline.length > 0) {
    prompt += `Timeline (5 event terakhir):\n`;
    const recent = orderContext.timeline.slice(-5);
    for (const t of recent) {
      const date = new Date(t.createdAt).toLocaleString('id-ID');
      prompt += `- [${date}] ${t.tipeEvent}: ${t.deskripsi}\n`;
    }
    prompt += `\n`;
  }

  if (orderContext.payments.length > 0) {
    prompt += `Pembayaran:\n`;
    for (const p of orderContext.payments) {
      const date = new Date(p.createdAt).toLocaleString('id-ID');
      prompt += `- ${p.jenis} Rp ${p.jumlah.toLocaleString('id-ID')} — status: ${p.status} (${date})\n`;
    }
    prompt += `\n`;
  }

  if (orderContext.invoices.length > 0) {
    prompt += `Invoice:\n`;
    for (const inv of orderContext.invoices) {
      prompt += `- ${inv.jenis} Rp ${inv.jumlah.toLocaleString('id-ID')} — status: ${inv.status}\n`;
    }
    prompt += `\n`;
  }

  if (orderContext.shipment) {
    prompt += `Pengiriman:\n`;
    prompt += `- Kurir: ${orderContext.shipment.kurir}\n`;
    if (orderContext.shipment.noResi) {
      prompt += `- No resi: ${orderContext.shipment.noResi}\n`;
    }
    prompt += `- Status: ${orderContext.shipment.status}\n`;
    if (orderContext.shipment.shippedAt) {
      prompt += `- Dikirim: ${new Date(orderContext.shipment.shippedAt).toLocaleString('id-ID')}\n`;
    }
    if (orderContext.shipment.deliveredAt) {
      prompt += `- Diterima: ${new Date(orderContext.shipment.deliveredAt).toLocaleString('id-ID')}\n`;
    }
    prompt += `\n`;
  } else {
    prompt += `Pengiriman: belum ada\n\n`;
  }

  prompt += `PERTANYAAN PELANGGAN:\n"${pertanyaan}"\n\n`;
  prompt += `Jawab pertanyaan di atas HANYA berdasarkan konteks order. Jika tidak bisa dijawab, return canAnswer=false.`;

  return prompt;
}
