import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiAssistantService } from './ai-assistant.service';

/**
 * Unit test untuk AiAssistantService (Fase 12 Bagian 2).
 *
 * Memverifikasi:
 * - HTTP call ke ai-gateway dengan method, path, dan body yang benar
 * - Fail-safe: timeout / error / non-2xx → return null (bukan throw)
 * - X-Customer-ID header / body customerId diteruskan untuk rate limit
 */
describe('AiAssistantService', () => {
  let service: AiAssistantService;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAssistantService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string, defaultValue?: string) => {
              if (key === 'AI_GATEWAY_URL') return 'http://ai-gateway.test:3002';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AiAssistantService>(AiAssistantService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('suggestQuotation', () => {
    it('should POST to /ai/quotation-assistant with customerId and return result', async () => {
      const mockResponse = { saran_harga: { harga_per_pcs: { low: 85000, high: 120000 } } };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await service.suggestQuotation(
        { productType: 'Kaos', qty: 10, complexity: 'SEDANG' },
        'cust-123',
      );

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://ai-gateway.test:3002/ai/quotation-assistant',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productType: 'Kaos',
            qty: 10,
            complexity: 'SEDANG',
            customerId: 'cust-123',
          }),
        }),
      );
    });

    it('should return null when AI gateway returns non-2xx (fail-safe)', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await service.suggestQuotation({ productType: 'Kaos', qty: 10 }, 'cust-123');

      expect(result).toBeNull();
    });

    it('should return null when fetch throws (network/timeout)', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await service.suggestQuotation({ productType: 'Kaos', qty: 10 }, 'cust-123');

      expect(result).toBeNull();
    });
  });

  describe('answerCustomerQuestion', () => {
    const baseContext = {
      orderNumber: 'MLV-20260718-0001',
      status: 'ANTREAN',
      items: [{ productType: 'Kaos', qty: 50, basePriceSnapshot: 85000 }],
      timeline: [],
      payments: [],
      invoices: [],
      shipment: null,
    };

    it('should POST to /ai/customer-support with full order context', async () => {
      const mockResponse = { hasil: { canAnswer: true, jawaban: 'Test' } };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await service.answerCustomerQuestion(
        'Kapan selesai?',
        baseContext,
        'cust-456',
      );

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://ai-gateway.test:3002/ai/customer-support',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            pertanyaan: 'Kapan selesai?',
            orderContext: baseContext,
            customerId: 'cust-456',
          }),
        }),
      );
    });

    it('should return null when AI gateway unavailable', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await service.answerCustomerQuestion('Halo?', baseContext, 'cust-456');

      expect(result).toBeNull();
    });
  });
});
