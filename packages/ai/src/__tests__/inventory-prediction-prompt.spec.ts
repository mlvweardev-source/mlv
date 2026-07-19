import {
  buildInventoryPredictionSystemPrompt,
  buildInventoryPredictionUserPrompt,
} from '../prompt-templates/inventory-prediction';

describe('Inventory Prediction Prompt Templates', () => {
  describe('buildInventoryPredictionSystemPrompt', () => {
    it('should return a non-empty system prompt', () => {
      const prompt = buildInventoryPredictionSystemPrompt();
      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('should mention key rules about recommendations only', () => {
      const prompt = buildInventoryPredictionSystemPrompt();
      expect(prompt).toContain('HANYA memberi saran');
      expect(prompt).toContain('TIDAK PERNAH');
    });

    it('should define JSON output structure', () => {
      const prompt = buildInventoryPredictionSystemPrompt();
      expect(prompt).toContain('prediksi');
      expect(prompt).toContain('KRITIS');
      expect(prompt).toContain('RENDAH');
      expect(prompt).toContain('AMAN');
      expect(prompt).toContain('saran_qty_beli');
    });
  });

  describe('buildInventoryPredictionUserPrompt', () => {
    it('should include stock balances', () => {
      const prompt = buildInventoryPredictionUserPrompt({
        stockBalances: [
          {
            materialNama: 'Kain Katun',
            materialId: 'mat-1',
            satuan: 'meter',
            qtyAvailable: 100,
            qtyReserved: 20,
            freeStock: 80,
          },
        ],
        usageTrends: [],
        activeOrderCount: 5,
        bomSummary: [],
      });

      expect(prompt).toContain('Kain Katun');
      expect(prompt).toContain('100');
      expect(prompt).toContain('meter');
    });

    it('should include usage trends', () => {
      const prompt = buildInventoryPredictionUserPrompt({
        stockBalances: [],
        usageTrends: [
          {
            materialNama: 'Kain Katun',
            materialId: 'mat-1',
            totalUsed: 150,
            periodeHari: 30,
            avgPerDay: 5,
          },
        ],
        activeOrderCount: 5,
        bomSummary: [],
      });

      expect(prompt).toContain('Kain Katun');
      expect(prompt).toContain('150');
      expect(prompt).toContain('5.00/hari');
    });

    it('should include BOM summary', () => {
      const prompt = buildInventoryPredictionUserPrompt({
        stockBalances: [],
        usageTrends: [],
        activeOrderCount: 3,
        bomSummary: [
          {
            productType: 'Kaos',
            materials: [{ materialNama: 'Kain Katun', qtyPerUnit: 2, satuan: 'meter' }],
          },
        ],
      });

      expect(prompt).toContain('Kaos');
      expect(prompt).toContain('Kain Katun');
    });
  });
});
