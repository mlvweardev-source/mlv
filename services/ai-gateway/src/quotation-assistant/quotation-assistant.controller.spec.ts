import { Test, TestingModule } from '@nestjs/testing';
import { QuotationAssistantController } from './quotation-assistant.controller';
import { QuotationAssistantService } from './quotation-assistant.service';

describe('QuotationAssistantController', () => {
  let controller: QuotationAssistantController;
  let mockService: { suggest: jest.Mock };

  beforeEach(async () => {
    mockService = {
      suggest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuotationAssistantController],
      providers: [{ provide: QuotationAssistantService, useValue: mockService }],
    }).compile();

    controller = module.get<QuotationAssistantController>(QuotationAssistantController);
  });

  it('should return AI suggestion', async () => {
    const mockResult = {
      harga_per_pcs: { low: 85000, high: 120000 },
      total_estimasi: { low: 850000, high: 1200000 },
      alasan: 'Bahan cotton combed 30s',
      faktor_pendorong_harga: ['bahan premium'],
      saran_untuk_staf: null,
    };

    mockService.suggest.mockResolvedValue(mockResult);

    const result = await controller.suggest({
      productType: 'Kaos',
      qty: 10,
      complexity: 'SEDANG',
      catatanStaf: 'Cotton combed 30s',
      basePriceReference: 85000,
      customerId: 'customer-1',
    });

    expect(result).toEqual({ saran_harga: mockResult });
    expect(mockService.suggest).toHaveBeenCalledWith({
      productType: 'Kaos',
      qty: 10,
      complexity: 'SEDANG',
      designSummary: null,
      catatanStaf: 'Cotton combed 30s',
      basePriceReference: 85000,
    });
  });

  it('should return null saran_harga when service returns null', async () => {
    mockService.suggest.mockResolvedValue(null);

    const result = await controller.suggest({
      productType: 'Kaos',
      qty: 10,
      customerId: 'customer-1',
    });

    expect(result).toEqual({ saran_harga: null });
  });

  it('should handle missing optional fields with defaults', async () => {
    mockService.suggest.mockResolvedValue(null);

    await controller.suggest({
      productType: 'Hoodie',
      qty: 50,
      customerId: 'customer-1',
    });

    expect(mockService.suggest).toHaveBeenCalledWith({
      productType: 'Hoodie',
      qty: 50,
      complexity: null,
      designSummary: null,
      catatanStaf: undefined,
      basePriceReference: undefined,
    });
  });
});
