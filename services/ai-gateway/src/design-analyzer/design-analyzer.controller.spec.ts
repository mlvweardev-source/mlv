import { Test, TestingModule } from '@nestjs/testing';
import { DesignAnalyzerController } from './design-analyzer.controller';
import { DesignAnalyzerService } from './design-analyzer.service';

describe('DesignAnalyzerController', () => {
  let controller: DesignAnalyzerController;
  let mockService: { analyze: jest.Mock };

  beforeEach(async () => {
    mockService = {
      analyze: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DesignAnalyzerController],
      providers: [{ provide: DesignAnalyzerService, useValue: mockService }],
    }).compile();

    controller = module.get<DesignAnalyzerController>(DesignAnalyzerController);
  });

  it('should return AI result', async () => {
    const mockResult = {
      warna: { kain: 'Biru', aksen: null },
      lokasi_print: [],
      estimasi_kompleksitas: 'RENDAH',
      catatan_tambahan: null,
      saran_untuk_pelanggan: null,
    };

    mockService.analyze.mockResolvedValue(mockResult);

    const result = await controller.analyze({
      catatanTeks: 'Warna biru',
      productType: 'Kaos',
      customerId: 'customer-1',
    });

    expect(result).toEqual({ hasil_ekstraksi_ai: mockResult });
    expect(mockService.analyze).toHaveBeenCalledWith({
      catatanTeks: 'Warna biru',
      productType: 'Kaos',
    });
  });

  it('should return null when service returns null', async () => {
    mockService.analyze.mockResolvedValue(null);

    const result = await controller.analyze({
      productType: 'Kaos',
      customerId: 'customer-1',
    });

    expect(result).toEqual({ hasil_ekstraksi_ai: null });
  });
});
