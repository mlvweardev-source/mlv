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

  describe('suggestProductionAnalysis', () => {
    const baseProductionContext = {
      orderNumber: 'MLV-20260719-0001',
      orderStatus: 'ANTREAN',
      tasks: [
        {
          taskType: 'CUTTING',
          sequence: 1,
          status: 'SEDANG_DILAKSANAKAN',
          assignedToNama: 'Budi',
          productType: 'Kaos',
          startedAt: '2026-07-19T10:00:00Z',
        },
      ],
      taskCountByStage: {
        CUTTING: { total: 2, active: 1, waiting: 1 },
      },
    };

    it('should POST to /ai/production-assistant with production context', async () => {
      const mockResponse = {
        insight: {
          estimasi_lead_time: '2 hari',
          bottleneck: { terdeteksi: false, tahap: null, alasan: null, jumlah_task_menumpuk: null },
          saran_urutan: [],
          ringkasan: 'Normal',
        },
      };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await service.suggestProductionAnalysis(baseProductionContext, 'owner-1');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://ai-gateway.test:3002/ai/production-assistant',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ...baseProductionContext,
            customerId: 'owner-1',
          }),
        }),
      );
    });

    it('should return null when AI gateway unavailable', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await service.suggestProductionAnalysis(baseProductionContext, 'owner-1');

      expect(result).toBeNull();
    });

    it('should return null when fetch throws', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await service.suggestProductionAnalysis(baseProductionContext, 'owner-1');

      expect(result).toBeNull();
    });
  });

  describe('predictInventory', () => {
    const baseInventoryContext = {
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
      bomSummary: [
        {
          productType: 'Kaos',
          materials: [{ materialNama: 'Kain Katun', qtyPerUnit: 2, satuan: 'meter' }],
        },
      ],
    };

    it('should POST to /ai/inventory-prediction with inventory context', async () => {
      const mockResponse = {
        prediksi: {
          prediksi: [
            {
              materialNama: 'Kain Katun',
              materialId: 'mat-1',
              status: 'AMAN',
              stok_saat_ini: 100,
              free_stock: 80,
              avg_per_day: 5,
              estimasi_habis_hari: 16,
              saran_qty_beli: 0,
              satuan: 'meter',
              alasan: 'Stok aman',
            },
          ],
          ringkasan: 'Semua material aman',
          rekomendasi_umum: 'Tidak perlu restock',
        },
      };
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await service.predictInventory(baseInventoryContext, 'owner-1');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://ai-gateway.test:3002/ai/inventory-prediction',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ...baseInventoryContext,
            customerId: 'owner-1',
          }),
        }),
      );
    });

    it('should return null when AI gateway unavailable', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await service.predictInventory(baseInventoryContext, 'owner-1');

      expect(result).toBeNull();
    });
  });
});
