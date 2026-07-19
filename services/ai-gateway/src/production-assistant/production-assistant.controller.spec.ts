import { Test, TestingModule } from '@nestjs/testing';
import { ProductionAssistantController } from './production-assistant.controller';
import { ProductionAssistantService } from './production-assistant.service';

describe('ProductionAssistantController', () => {
  let controller: ProductionAssistantController;
  let service: ProductionAssistantService;

  beforeEach(async () => {
    const mockService = {
      analyze: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductionAssistantController],
      providers: [{ provide: ProductionAssistantService, useValue: mockService }],
    }).compile();

    controller = module.get<ProductionAssistantController>(ProductionAssistantController);
    service = module.get<ProductionAssistantService>(ProductionAssistantService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call service.analyze with input and return result', async () => {
    const mockInsight = {
      estimasi_lead_time: '2 hari',
      bottleneck: { terdeteksi: false, tahap: null, alasan: null, jumlah_task_menumpuk: null },
      saran_urutan: [],
      ringkasan: 'Normal',
    };
    (service.analyze as jest.Mock).mockResolvedValue(mockInsight);

    const result = await controller.analyze({
      orderNumber: 'MLV-001',
      orderStatus: 'ANTREAN',
      tasks: [],
      taskCountByStage: {},
      customerId: 'cust-1',
    });

    expect(result).toEqual({ insight: mockInsight });
    expect(service.analyze).toHaveBeenCalledWith({
      orderNumber: 'MLV-001',
      orderStatus: 'ANTREAN',
      tasks: [],
      taskCountByStage: {},
    });
  });

  it('should return null insight when service returns null', async () => {
    (service.analyze as jest.Mock).mockResolvedValue(null);

    const result = await controller.analyze({
      orderNumber: 'MLV-001',
      orderStatus: 'ANTREAN',
      tasks: [],
      taskCountByStage: {},
      customerId: 'cust-1',
    });

    expect(result).toEqual({ insight: null });
  });
});
