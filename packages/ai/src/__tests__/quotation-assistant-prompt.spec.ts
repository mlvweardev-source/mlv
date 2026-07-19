import {
  buildQuotationSystemPrompt,
  buildQuotationUserPrompt,
} from '../prompt-templates/quotation-assistant';

describe('Quotation Assistant Prompt Templates', () => {
  describe('buildQuotationSystemPrompt', () => {
    it('should return a non-empty system prompt', () => {
      const prompt = buildQuotationSystemPrompt();
      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('should mention JSON format and required fields', () => {
      const prompt = buildQuotationSystemPrompt();
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('harga_per_pcs');
      expect(prompt).toContain('total_estimasi');
      expect(prompt).toContain('alasan');
    });

    it('should emphasize human confirmation (AI only suggests)', () => {
      const prompt = buildQuotationSystemPrompt();
      expect(prompt).toMatch(/HANYA|saransaran|menyarankan|approval/i);
    });
  });

  describe('buildQuotationUserPrompt', () => {
    it('should include product type and qty', () => {
      const prompt = buildQuotationUserPrompt({
        productType: 'Kaos',
        qty: 50,
      });
      expect(prompt).toContain('Kaos');
      expect(prompt).toContain('50 pcs');
    });

    it('should include complexity when provided', () => {
      const prompt = buildQuotationUserPrompt({
        productType: 'Kaos',
        qty: 10,
        complexity: 'TINGGI',
      });
      expect(prompt).toContain('TINGGI');
    });

    it('should handle missing complexity (default SEDANG)', () => {
      const prompt = buildQuotationUserPrompt({
        productType: 'Kaos',
        qty: 10,
      });
      expect(prompt).toContain('SEDANG');
      expect(prompt).toContain('tidak dianalisis');
    });

    it('should include design summary when provided', () => {
      const prompt = buildQuotationUserPrompt({
        productType: 'Kaos',
        qty: 10,
        designSummary: '3 lokasi print, 5 warna',
      });
      expect(prompt).toContain('3 lokasi print');
    });

    it('should include catatan staf when provided', () => {
      const prompt = buildQuotationUserPrompt({
        productType: 'Hoodie',
        qty: 20,
        catatanStaf: 'Cotton combed 30s, sablon 4 warna',
      });
      expect(prompt).toContain('Cotton combed 30s');
    });

    it('should include base price reference when provided', () => {
      const prompt = buildQuotationUserPrompt({
        productType: 'Kaos',
        qty: 10,
        basePriceReference: 85000,
      });
      expect(prompt).toContain('85.000');
    });
  });
});
