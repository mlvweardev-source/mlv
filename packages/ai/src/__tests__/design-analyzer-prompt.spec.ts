import {
  buildDesignAnalyzerSystemPrompt,
  buildDesignAnalyzerUserPrompt,
} from '../prompt-templates/design-analyzer';

describe('Design Analyzer Prompt Templates', () => {
  describe('buildDesignAnalyzerSystemPrompt', () => {
    it('should return a non-empty system prompt', () => {
      const prompt = buildDesignAnalyzerSystemPrompt();
      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('should mention JSON format', () => {
      const prompt = buildDesignAnalyzerSystemPrompt();
      expect(prompt).toContain('JSON');
    });

    it('should mention warna, lokasi_print, estimasi_kompleksitas', () => {
      const prompt = buildDesignAnalyzerSystemPrompt();
      expect(prompt).toContain('warna');
      expect(prompt).toContain('lokasi_print');
      expect(prompt).toContain('estimasi_kompleksitas');
    });
  });

  describe('buildDesignAnalyzerUserPrompt', () => {
    it('should include product type', () => {
      const prompt = buildDesignAnalyzerUserPrompt({
        productType: 'Kaos',
        catatanTeks: 'Warna biru',
      });
      expect(prompt).toContain('Kaos');
    });

    it('should include catatan teks when provided', () => {
      const prompt = buildDesignAnalyzerUserPrompt({
        productType: 'Kaos',
        catatanTeks: 'Warna biru Navy dengan logo di depan',
      });
      expect(prompt).toContain('Warna biru Navy dengan logo di depan');
    });

    it('should handle missing catatan teks', () => {
      const prompt = buildDesignAnalyzerUserPrompt({
        productType: 'Kaos',
      });
      expect(prompt).toContain('tidak memberikan catatan');
    });
  });
});
