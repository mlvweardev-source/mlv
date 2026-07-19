import {
  buildCustomerSupportSystemPrompt,
  buildCustomerSupportUserPrompt,
} from '../prompt-templates/customer-support';

describe('Customer Support Prompt Templates', () => {
  describe('buildCustomerSupportSystemPrompt', () => {
    it('should return a non-empty system prompt', () => {
      const prompt = buildCustomerSupportSystemPrompt();
      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('should mention JSON format and required fields', () => {
      const prompt = buildCustomerSupportSystemPrompt();
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('canAnswer');
      expect(prompt).toContain('jawaban');
      expect(prompt).toContain('alasan_eskalasi');
    });

    it('should emphasize context-only answering (no hallucination)', () => {
      const prompt = buildCustomerSupportSystemPrompt();
      expect(prompt).toMatch(/HANYA|tidak menebak|konteks/i);
    });

    it('should list examples of in-context questions', () => {
      const prompt = buildCustomerSupportSystemPrompt();
      // Should mention "Kapan" (when) since that's the most common in-context question
      expect(prompt).toMatch(/Kapan|kapan/);
    });

    it('should list examples of escalation scenarios', () => {
      const prompt = buildCustomerSupportSystemPrompt();
      expect(prompt).toMatch(/diskon|komplain|revisi/i);
    });
  });

  describe('buildCustomerSupportUserPrompt', () => {
    const baseContext = {
      orderNumber: 'MLV-20260718-0001',
      status: 'ANTREAN',
      items: [{ productType: 'Kaos', qty: 50, basePriceSnapshot: 85000 }],
      timeline: [
        { tipeEvent: 'DIBUAT', deskripsi: 'Order dibuat', createdAt: '2026-07-18T10:00:00Z' },
      ],
      payments: [
        {
          jenis: 'DP' as const,
          jumlah: 2125000,
          status: 'SUCCESS',
          createdAt: '2026-07-18T11:00:00Z',
        },
      ],
      invoices: [{ jenis: 'DP' as const, jumlah: 2125000, status: 'PAID' }],
      shipment: null,
    };

    it('should include order number and status', () => {
      const prompt = buildCustomerSupportUserPrompt({
        pertanyaan: 'Kapan selesai?',
        orderContext: baseContext,
      });
      expect(prompt).toContain('MLV-20260718-0001');
      expect(prompt).toContain('ANTREAN');
    });

    it('should include items', () => {
      const prompt = buildCustomerSupportUserPrompt({
        pertanyaan: 'Berapa qty saya?',
        orderContext: baseContext,
      });
      expect(prompt).toContain('Kaos');
      expect(prompt).toContain('50 pcs');
      expect(prompt).toContain('85.000');
    });

    it('should include payment info', () => {
      const prompt = buildCustomerSupportUserPrompt({
        pertanyaan: 'Sudah dibayar?',
        orderContext: baseContext,
      });
      expect(prompt).toContain('DP');
      expect(prompt).toContain('2.125.000');
      expect(prompt).toContain('SUCCESS');
    });

    it('should include shipment info when available', () => {
      const prompt = buildCustomerSupportUserPrompt({
        pertanyaan: 'Kapan dikirim?',
        orderContext: {
          ...baseContext,
          shipment: {
            kurir: 'JNE',
            noResi: 'JNE123456',
            status: 'DIKIRIM',
            shippedAt: '2026-07-19T08:00:00Z',
            deliveredAt: null,
          },
        },
      });
      expect(prompt).toContain('JNE');
      expect(prompt).toContain('JNE123456');
      expect(prompt).toContain('DIKIRIM');
    });

    it('should indicate no shipment when null', () => {
      const prompt = buildCustomerSupportUserPrompt({
        pertanyaan: 'Kapan dikirim?',
        orderContext: baseContext,
      });
      expect(prompt).toContain('belum ada');
    });

    it('should include the customer question verbatim', () => {
      const prompt = buildCustomerSupportUserPrompt({
        pertanyaan: 'Bisa minta diskon 20%?',
        orderContext: baseContext,
      });
      expect(prompt).toContain('Bisa minta diskon 20%?');
    });
  });
});
