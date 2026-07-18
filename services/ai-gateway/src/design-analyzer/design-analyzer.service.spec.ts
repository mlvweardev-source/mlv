import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DesignAnalyzerService } from './design-analyzer.service';

// Mock @mlv/ai
jest.mock('@mlv/ai', () => ({
  GeminiClient: jest.fn().mockImplementation(() => ({
    generate: jest.fn(),
  })),
  buildDesignAnalyzerSystemPrompt: jest.fn().mockReturnValue('system prompt'),
  buildDesignAnalyzerUserPrompt: jest.fn().mockReturnValue('user prompt'),
}));

import { GeminiClient } from '@mlv/ai';

describe('DesignAnalyzerService', () => {
  let service: DesignAnalyzerService;
  let mockGenerate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerate = jest.fn();
    (GeminiClient as jest.Mock).mockImplementation(() => ({
      generate: mockGenerate,
    }));
  });

  describe('with API key configured', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DesignAnalyzerService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockImplementation((key: string) => {
                if (key === 'GEMINI_API_KEY') return 'test-api-key';
                return null;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<DesignAnalyzerService>(DesignAnalyzerService);
    });

    it('should return structured result on success', async () => {
      const mockResult = {
        warna: { kain: 'Biru Navy', aksen: 'Hitam' },
        lokasi_print: [{ lokasi: 'depan', deskripsi: 'Logo', teknik: 'sablon' }],
        estimasi_kompleksitas: 'SEDANG',
        catatan_tambahan: null,
        saran_untuk_pelanggan: null,
      };

      mockGenerate.mockResolvedValue({
        text: JSON.stringify(mockResult),
        usage: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
      });

      const result = await service.analyze({
        catatanTeks: 'Warna biru Navy dengan logo di depan',
        productType: 'Kaos',
      });

      expect(result).toEqual(mockResult);
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.3,
          maxOutputTokens: 1024,
        }),
      );
    });

    it('should parse JSON from markdown code block', async () => {
      const mockResult = {
        warna: { kain: 'Merah', aksen: null },
        lokasi_print: [],
        estimasi_kompleksitas: 'RENDAH',
        catatan_tambahan: null,
        saran_untuk_pelanggan: null,
      };

      mockGenerate.mockResolvedValue({
        text: '```json\n' + JSON.stringify(mockResult) + '\n```',
      });

      const result = await service.analyze({
        catatanTeks: 'Warna merah',
        productType: 'Kaos',
      });

      expect(result).toEqual(mockResult);
    });

    it('should return null when Gemini call fails', async () => {
      mockGenerate.mockRejectedValue(new Error('API error'));

      const result = await service.analyze({
        catatanTeks: 'Test',
        productType: 'Kaos',
      });

      expect(result).toBeNull();
    });

    it('should return null when JSON parsing fails', async () => {
      mockGenerate.mockResolvedValue({
        text: 'This is not valid JSON',
      });

      const result = await service.analyze({
        catatanTeks: 'Test',
        productType: 'Kaos',
      });

      expect(result).toBeNull();
    });
  });

  describe('without API key', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DesignAnalyzerService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(null),
            },
          },
        ],
      }).compile();

      service = module.get<DesignAnalyzerService>(DesignAnalyzerService);
    });

    it('should return null when API key is not set', async () => {
      const result = await service.analyze({
        catatanTeks: 'Test',
        productType: 'Kaos',
      });

      expect(result).toBeNull();
    });
  });
});
