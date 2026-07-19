import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProductionAssistantService } from './production-assistant.service';

// Mock @mlv/ai
jest.mock('@mlv/ai', () => ({
  GeminiClient: jest.fn().mockImplementation(() => ({
    generate: jest.fn(),
  })),
  buildProductionAssistantSystemPrompt: jest.fn().mockReturnValue('system prompt'),
  buildProductionAssistantUserPrompt: jest.fn().mockReturnValue('user prompt'),
}));

import { GeminiClient } from '@mlv/ai';

describe('ProductionAssistantService', () => {
  let service: ProductionAssistantService;
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
          ProductionAssistantService,
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

      service = module.get<ProductionAssistantService>(ProductionAssistantService);
    });

    it('should return structured insight on success', async () => {
      const mockResult = {
        estimasi_lead_time: '2-3 hari kerja',
        bottleneck: {
          terdeteksi: true,
          tahap: 'SEWING',
          alasan: 'Task sewing menumpuk 5 task',
          jumlah_task_menumpuk: 5,
        },
        saran_urutan: [
          {
            prioritas: 'TINGGI',
            tahap: 'SEWING',
            saran: 'Prioritaskan order MLV-001',
            alasan: 'Deadline dekat',
          },
        ],
        ringkasan: 'Produksi bottleneck di tahap sewing',
      };

      mockGenerate.mockResolvedValue({
        text: JSON.stringify(mockResult),
        usage: { promptTokenCount: 200, candidatesTokenCount: 100, totalTokenCount: 300 },
      });

      const result = await service.analyze({
        orderNumber: 'MLV-20260719-0001',
        orderStatus: 'ANTREAN',
        tasks: [],
        taskCountByStage: {},
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
        estimasi_lead_time: '1 minggu',
        bottleneck: { terdeteksi: false, tahap: null, alasan: null, jumlah_task_menumpuk: null },
        saran_urutan: [],
        ringkasan: 'Kondisi produksi normal',
      };

      mockGenerate.mockResolvedValue({
        text: '```json\n' + JSON.stringify(mockResult) + '\n```',
      });

      const result = await service.analyze({
        orderNumber: 'MLV-001',
        orderStatus: 'ANTREAN',
        tasks: [],
        taskCountByStage: {},
      });

      expect(result).toEqual(mockResult);
    });

    it('should return null when Gemini call fails', async () => {
      mockGenerate.mockRejectedValue(new Error('API error'));

      const result = await service.analyze({
        orderNumber: 'MLV-001',
        orderStatus: 'ANTREAN',
        tasks: [],
        taskCountByStage: {},
      });

      expect(result).toBeNull();
    });

    it('should return null when JSON parsing fails', async () => {
      mockGenerate.mockResolvedValue({
        text: 'This is not valid JSON',
      });

      const result = await service.analyze({
        orderNumber: 'MLV-001',
        orderStatus: 'ANTREAN',
        tasks: [],
        taskCountByStage: {},
      });

      expect(result).toBeNull();
    });
  });

  describe('without API key', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ProductionAssistantService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(null),
            },
          },
        ],
      }).compile();

      service = module.get<ProductionAssistantService>(ProductionAssistantService);
    });

    it('should return null when API key is not set', async () => {
      const result = await service.analyze({
        orderNumber: 'MLV-001',
        orderStatus: 'ANTREAN',
        tasks: [],
        taskCountByStage: {},
      });

      expect(result).toBeNull();
    });
  });
});
