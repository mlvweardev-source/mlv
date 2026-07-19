import { Test, TestingModule } from '@nestjs/testing';
import { CustomerSupportController } from './customer-support.controller';
import { CustomerSupportService } from './customer-support.service';

describe('CustomerSupportController', () => {
  let controller: CustomerSupportController;
  let mockService: { answer: jest.Mock };

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

  beforeEach(async () => {
    mockService = {
      answer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomerSupportController],
      providers: [{ provide: CustomerSupportService, useValue: mockService }],
    }).compile();

    controller = module.get<CustomerSupportController>(CustomerSupportController);
  });

  it('should return AI result for in-context question', async () => {
    const mockResult = {
      canAnswer: true,
      jawaban: 'Order Anda berstatus Antrean produksi.',
      alasan_eskalasi: '',
    };

    mockService.answer.mockResolvedValue(mockResult);

    const result = await controller.answer({
      pertanyaan: 'Kapan pesanan saya selesai?',
      orderContext: baseOrderContext,
      customerId: 'customer-1',
    });

    expect(result).toEqual({ hasil: mockResult });
    expect(mockService.answer).toHaveBeenCalledWith({
      pertanyaan: 'Kapan pesanan saya selesai?',
      orderContext: baseOrderContext,
    });
  });

  it('should return null hasil when service returns null (AI unavailable)', async () => {
    mockService.answer.mockResolvedValue(null);

    const result = await controller.answer({
      pertanyaan: 'Halo?',
      orderContext: baseOrderContext,
      customerId: 'customer-1',
    });

    expect(result).toEqual({ hasil: null });
  });

  it('should pass through escalation result', async () => {
    const mockResult = {
      canAnswer: false,
      jawaban: '',
      alasan_eskalasi: 'Permintaan diskon perlu persetujuan Owner.',
    };

    mockService.answer.mockResolvedValue(mockResult);

    const result = await controller.answer({
      pertanyaan: 'Bisa diskon?',
      orderContext: baseOrderContext,
      customerId: 'customer-1',
    });

    expect(result).toEqual({ hasil: mockResult });
  });
});
