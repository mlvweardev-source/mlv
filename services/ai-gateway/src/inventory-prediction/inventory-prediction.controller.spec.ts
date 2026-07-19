import { Test, TestingModule } from '@nestjs/testing';
import { InventoryPredictionController } from './inventory-prediction.controller';
import { InventoryPredictionService } from './inventory-prediction.service';

describe('InventoryPredictionController', () => {
  let controller: InventoryPredictionController;
  let service: InventoryPredictionService;

  beforeEach(async () => {
    const mockService = {
      predict: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryPredictionController],
      providers: [{ provide: InventoryPredictionService, useValue: mockService }],
    }).compile();

    controller = module.get<InventoryPredictionController>(InventoryPredictionController);
    service = module.get<InventoryPredictionService>(InventoryPredictionService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call service.predict with input and return result', async () => {
    const mockPrediction = {
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
          alasan: 'Stok kritis',
        },
      ],
      ringkasan: 'Test',
      rekomendasi_umum: 'Test',
    };
    (service.predict as jest.Mock).mockResolvedValue(mockPrediction);

    const result = await controller.predict({
      stockBalances: [],
      usageTrends: [],
      activeOrderCount: 5,
      bomSummary: [],
      customerId: 'cust-1',
    });

    expect(result).toEqual({ prediksi: mockPrediction });
  });

  it('should return null prediksi when service returns null', async () => {
    (service.predict as jest.Mock).mockResolvedValue(null);

    const result = await controller.predict({
      stockBalances: [],
      usageTrends: [],
      activeOrderCount: 0,
      bomSummary: [],
      customerId: 'cust-1',
    });

    expect(result).toEqual({ prediksi: null });
  });
});
