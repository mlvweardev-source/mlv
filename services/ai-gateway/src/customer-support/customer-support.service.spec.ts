import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CustomerSupportService } from './customer-support.service';

// Mock @mlv/ai
jest.mock('@mlv/ai', () => ({
  GeminiClient: jest.fn().mockImplementation(() => ({
    generate: jest.fn(),
  })),
  buildCustomerSupportSystemPrompt: jest.fn().mockReturnValue('system prompt'),
  buildCustomerSupportUserPrompt: jest.fn().mockReturnValue('user prompt'),
}));

import { GeminiClient } from '@mlv/ai';

describe('CustomerSupportService', () => {
  let service: CustomerSupportService;
  let mockGenerate: jest.Mock;

  const baseOrderContext = {
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
          CustomerSupportService,
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

      service = module.get<CustomerSupportService>(CustomerSupportService);
    });

    it('should return canAnswer=true with answer for in-context question', async () => {
      const mockResult = {
        canAnswer: true,
        jawaban: 'Order Anda berstatus Antrean produksi dan akan segera diproses.',
        alasan_eskalasi: '',
      };

      mockGenerate.mockResolvedValue({
        text: JSON.stringify(mockResult),
        usage: { promptTokenCount: 300, candidatesTokenCount: 50, totalTokenCount: 350 },
      });

      const result = await service.answer({
        pertanyaan: 'Kapan pesanan saya selesai?',
        orderContext: baseOrderContext,
      });

      expect(result).toEqual(mockResult);
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.5,
          maxOutputTokens: 512,
          jsonMode: true,
        }),
      );
    });

    it('should return canAnswer=false with escalation reason for out-of-context question', async () => {
      const mockResult = {
        canAnswer: false,
        jawaban: '',
        alasan_eskalasi:
          'Permintaan diskon tidak bisa dijawab AI — perlu persetujuan Owner via approval.',
      };

      mockGenerate.mockResolvedValue({
        text: JSON.stringify(mockResult),
      });

      const result = await service.answer({
        pertanyaan: 'Bisa minta diskon 20%?',
        orderContext: baseOrderContext,
      });

      expect(result).toEqual(mockResult);
      expect(result?.canAnswer).toBe(false);
    });

    it('should parse JSON from markdown code block', async () => {
      const mockResult = {
        canAnswer: true,
        jawaban: 'Pembayaran DP Anda sudah sukses.',
        alasan_eskalasi: '',
      };

      mockGenerate.mockResolvedValue({
        text: '```json\n' + JSON.stringify(mockResult) + '\n```',
      });

      const result = await service.answer({
        pertanyaan: 'Sudah dibayar belum DP-nya?',
        orderContext: baseOrderContext,
      });

      expect(result).toEqual(mockResult);
    });

    it('should return null when Gemini call fails', async () => {
      mockGenerate.mockRejectedValue(new Error('API error'));

      const result = await service.answer({
        pertanyaan: 'Kapan dikirim?',
        orderContext: baseOrderContext,
      });

      expect(result).toBeNull();
    });

    it('should return null when canAnswer missing (invalid structure)', async () => {
      mockGenerate.mockResolvedValue({
        text: JSON.stringify({ jawaban: 'foo' }), // missing canAnswer
      });

      const result = await service.answer({
        pertanyaan: 'Halo?',
        orderContext: baseOrderContext,
      });

      expect(result).toBeNull();
    });

    it('should return null when canAnswer=true but jawaban empty', async () => {
      mockGenerate.mockResolvedValue({
        text: JSON.stringify({ canAnswer: true, jawaban: '', alasan_eskalasi: '' }),
      });

      const result = await service.answer({
        pertanyaan: 'Halo?',
        orderContext: baseOrderContext,
      });

      expect(result).toBeNull();
    });

    it('should return null when canAnswer=false but no escalation reason', async () => {
      mockGenerate.mockResolvedValue({
        text: JSON.stringify({ canAnswer: false, jawaban: '', alasan_eskalasi: '' }),
      });

      const result = await service.answer({
        pertanyaan: 'Minta refund',
        orderContext: baseOrderContext,
      });

      expect(result).toBeNull();
    });
  });

  describe('without API key', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CustomerSupportService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(null),
            },
          },
        ],
      }).compile();

      service = module.get<CustomerSupportService>(CustomerSupportService);
    });

    it('should return null when API key is not set', async () => {
      const result = await service.answer({
        pertanyaan: 'Kapan selesai?',
        orderContext: baseOrderContext,
      });

      expect(result).toBeNull();
    });
  });
});
