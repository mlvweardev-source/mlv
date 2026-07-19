import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InventoryPredictionService } from './inventory-prediction.service';

// Mock @mlv/ai
jest.mock('@mlv/ai', () => ({
  GeminiClient: jest.fn().mockImplementation(() => ({
    generate: jest.fn(),
  })),
  buildInventoryPredictionSystemPrompt: jest.fn().mockReturnValue('system prompt'),
  buildInventoryPredictionUserPrompt: jest.fn().mockReturnValue('user prompt'),
}));

import { GeminiClient } from '@mlv/ai';

describe('InventoryPredictionService', () => {
  let service: InventoryPredictionService;
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
          InventoryPredictionService,
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

      service = module.get<InventoryPredictionService>(InventoryPredictionService);
    });

    it('should return structured prediction on success', async () => {
      const mockResult = {
        prediksi: [
          {
            materialNama: 'Kain Katun',
            materialId: 'mat-1',
            status: 'KRITIS',
            stok_saat_ini: 10,
            free_stock: 3,
            avg_per_day: 5,
            estimasi_habis_hari: 0.6,
            saran_qty_beli: 100,
            satuan: 'meter',
            alasan: 'Stok kritis, akan habis dalam 1 hari',
          },
        ],
        ringkasan: 'Material Kain Katun perlu segera direstock',
        rekomendasi_umum: 'Segera buat PO untuk Kain Katun',
      };

      mockGenerate.mockResolvedValue({
        text: JSON.stringify(mockResult),
        usage: { promptTokenCount: 300, candidatesTokenCount: 200, totalTokenCount: 500 },
      });

      const result = await service.predict({
        stockBalances: [],
        usageTrends: [],
        activeOrderCount: 5,
        bomSummary: [],
      });

      expect(result).toEqual(mockResult);
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.3,
          maxOutputTokens: 2048,
          jsonMode: true,
        }),
      );
    });

    it('should parse JSON from markdown code block', async () => {
      const mockResult = {
        prediksi: [],
        ringkasan: 'Semua material aman',
        rekomendasi_umum: 'Tidak perlu restock saat ini',
      };

      mockGenerate.mockResolvedValue({
        text: '```json\n' + JSON.stringify(mockResult) + '\n```',
      });

      const result = await service.predict({
        stockBalances: [],
        usageTrends: [],
        activeOrderCount: 0,
        bomSummary: [],
      });

      expect(result).toEqual(mockResult);
    });

    it('should return null when Gemini call fails', async () => {
      mockGenerate.mockRejectedValue(new Error('API error'));

      const result = await service.predict({
        stockBalances: [],
        usageTrends: [],
        activeOrderCount: 0,
        bomSummary: [],
      });

      expect(result).toBeNull();
    });

    it('should return null when JSON parsing fails', async () => {
      mockGenerate.mockResolvedValue({
        text: 'This is not valid JSON',
      });

      const result = await service.predict({
        stockBalances: [],
        usageTrends: [],
        activeOrderCount: 0,
        bomSummary: [],
      });

      expect(result).toBeNull();
    });

    it('should return null when response missing prediksi array', async () => {
      mockGenerate.mockResolvedValue({
        text: JSON.stringify({ ringkasan: 'test' }),
      });

      const result = await service.predict({
        stockBalances: [],
        usageTrends: [],
        activeOrderCount: 0,
        bomSummary: [],
      });

      expect(result).toBeNull();
    });
  });

  describe('without API key', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          InventoryPredictionService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(null),
            },
          },
        ],
      }).compile();

      service = module.get<InventoryPredictionService>(InventoryPredictionService);
    });

    it('should return null when API key is not set', async () => {
      const result = await service.predict({
        stockBalances: [],
        usageTrends: [],
        activeOrderCount: 0,
        bomSummary: [],
      });

      expect(result).toBeNull();
    });
  });
});
