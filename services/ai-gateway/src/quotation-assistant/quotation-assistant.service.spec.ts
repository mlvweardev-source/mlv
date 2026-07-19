import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QuotationAssistantService } from './quotation-assistant.service';

// Mock @mlv/ai
jest.mock('@mlv/ai', () => ({
  GeminiClient: jest.fn().mockImplementation(() => ({
    generate: jest.fn(),
  })),
  buildQuotationSystemPrompt: jest.fn().mockReturnValue('system prompt'),
  buildQuotationUserPrompt: jest.fn().mockReturnValue('user prompt'),
}));

import { GeminiClient } from '@mlv/ai';

describe('QuotationAssistantService', () => {
  let service: QuotationAssistantService;
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
          QuotationAssistantService,
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

      service = module.get<QuotationAssistantService>(QuotationAssistantService);
    });

    it('should return structured price range on success', async () => {
      const mockResult = {
        harga_per_pcs: { low: 85000, high: 120000 },
        total_estimasi: { low: 850000, high: 1200000 },
        alasan: 'Bahan cotton combed 30s, sablon 4 warna, quantity 10 pcs',
        faktor_pendorong_harga: ['bahan premium', 'sablon multi-warna'],
        saran_untuk_staf: 'pertimbangkan approval harga khusus',
      };

      mockGenerate.mockResolvedValue({
        text: JSON.stringify(mockResult),
        usage: { promptTokenCount: 200, candidatesTokenCount: 100, totalTokenCount: 300 },
      });

      const result = await service.suggest({
        productType: 'Kaos',
        qty: 10,
        complexity: 'SEDANG',
        catatanStaf: 'Cotton combed 30s, sablon 4 warna',
        basePriceReference: 85000,
      });

      expect(result).toEqual(mockResult);
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.3,
          maxOutputTokens: 1024,
          jsonMode: true,
        }),
      );
    });

    it('should parse JSON from markdown code block', async () => {
      const mockResult = {
        harga_per_pcs: { low: 100000, high: 150000 },
        total_estimasi: { low: 500000, high: 750000 },
        alasan: 'Bahan standar',
        faktor_pendorong_harga: [],
        saran_untuk_staf: null,
      };

      mockGenerate.mockResolvedValue({
        text: '```json\n' + JSON.stringify(mockResult) + '\n```',
      });

      const result = await service.suggest({
        productType: 'Hoodie',
        qty: 5,
        complexity: 'RENDAH',
      });

      expect(result).toEqual(mockResult);
    });

    it('should swap low/high if AI returns inverted values', async () => {
      const mockResult = {
        harga_per_pcs: { low: 150000, high: 85000 }, // inverted!
        total_estimasi: { low: 750000, high: 425000 },
        alasan: 'Test',
        faktor_pendorong_harga: [],
        saran_untuk_staf: null,
      };

      mockGenerate.mockResolvedValue({
        text: JSON.stringify(mockResult),
      });

      const result = await service.suggest({
        productType: 'Kaos',
        qty: 5,
      });

      expect(result?.harga_per_pcs.low).toBe(85000);
      expect(result?.harga_per_pcs.high).toBe(150000);
    });

    it('should return null when Gemini call fails', async () => {
      mockGenerate.mockRejectedValue(new Error('API error'));

      const result = await service.suggest({
        productType: 'Kaos',
        qty: 10,
      });

      expect(result).toBeNull();
    });

    it('should return null when JSON parsing fails', async () => {
      mockGenerate.mockResolvedValue({
        text: 'This is not valid JSON',
      });

      const result = await service.suggest({
        productType: 'Kaos',
        qty: 10,
      });

      expect(result).toBeNull();
    });

    it('should return null when response missing required fields', async () => {
      mockGenerate.mockResolvedValue({
        text: JSON.stringify({ alasan: 'no price fields' }),
      });

      const result = await service.suggest({
        productType: 'Kaos',
        qty: 10,
      });

      expect(result).toBeNull();
    });
  });

  describe('without API key', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          QuotationAssistantService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(null),
            },
          },
        ],
      }).compile();

      service = module.get<QuotationAssistantService>(QuotationAssistantService);
    });

    it('should return null when API key is not set', async () => {
      const result = await service.suggest({
        productType: 'Kaos',
        qty: 10,
      });

      expect(result).toBeNull();
    });
  });
});
