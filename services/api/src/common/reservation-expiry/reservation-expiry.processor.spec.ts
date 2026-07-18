import { Test, TestingModule } from '@nestjs/testing';
import { ReservationExpiryProcessor } from './reservation-expiry.processor';
import { EventBusService } from '../../event-bus/event-bus.service';
import { CustomerService } from '../../domains/customer/services/customer.service';
import { OrderService } from '../../domains/order/services/order.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

// Mock prisma
jest.mock('@mlv/db', () => ({
  prisma: {
    stockReservation: {
      findMany: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
    },
  },
}));

import { prisma } from '@mlv/db';

describe('ReservationExpiryProcessor', () => {
  let processor: ReservationExpiryProcessor;
  let mockEventBus: { publish: jest.Mock };
  let mockCustomerService: { getCustomerByIdInternal: jest.Mock };
  let mockOrderService: {
    releaseReservationsForOrder: jest.Mock;
    cancelOrderByFinance: jest.Mock;
  };
  let mockActivityLog: { log: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockEventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    mockCustomerService = {
      getCustomerByIdInternal: jest.fn().mockResolvedValue({
        id: 'customer-1',
        nama: 'Budi Santoso',
        noHp: '+628123456789',
      }),
    };
    mockOrderService = {
      releaseReservationsForOrder: jest.fn().mockResolvedValue(2),
      cancelOrderByFinance: jest.fn().mockResolvedValue(undefined),
    };
    mockActivityLog = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationExpiryProcessor,
        { provide: EventBusService, useValue: mockEventBus },
        { provide: CustomerService, useValue: mockCustomerService },
        { provide: OrderService, useValue: mockOrderService },
        { provide: ActivityLogService, useValue: mockActivityLog },
      ],
    }).compile();

    processor = module.get<ReservationExpiryProcessor>(ReservationExpiryProcessor);
  });

  it('should do nothing when no expired reservations found', async () => {
    (prisma.stockReservation.findMany as jest.Mock).mockResolvedValue([]);

    await processor.process({ id: 'job-1' } as any);

    expect(mockOrderService.releaseReservationsForOrder).not.toHaveBeenCalled();
    expect(mockOrderService.cancelOrderByFinance).not.toHaveBeenCalled();
    expect(mockEventBus.publish).not.toHaveBeenCalled();
  });

  it('should release reservations and cancel order for expired reservation', async () => {
    (prisma.stockReservation.findMany as jest.Mock).mockResolvedValue([{ orderId: 'order-1' }]);
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-1',
      orderNumber: 'MLV-20260718-0001',
      status: 'MENUNGGU_PEMBAYARAN_DP',
      customerId: 'customer-1',
    });

    await processor.process({ id: 'job-1' } as any);

    expect(mockOrderService.releaseReservationsForOrder).toHaveBeenCalledWith('order-1');
    expect(mockOrderService.cancelOrderByFinance).toHaveBeenCalledWith(
      'order-1',
      'Reservasi kadaluarsa — DP tidak dibayar dalam 24 jam',
    );
    expect(mockEventBus.publish).toHaveBeenCalledWith(
      'reservation.expired',
      expect.objectContaining({
        orderId: 'order-1',
        orderNumber: 'MLV-20260718-0001',
        customerNama: 'Budi Santoso',
        customerNoHp: '+628123456789',
      }),
    );
    expect(mockActivityLog.log).toHaveBeenCalled();
  });

  it('should skip order that is not MENUNGGU_PEMBAYARAN_DP (idempotent)', async () => {
    (prisma.stockReservation.findMany as jest.Mock).mockResolvedValue([{ orderId: 'order-1' }]);
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-1',
      orderNumber: 'MLV-20260718-0001',
      status: 'DIBATALKAN', // Already cancelled
      customerId: 'customer-1',
    });

    await processor.process({ id: 'job-1' } as any);

    expect(mockOrderService.releaseReservationsForOrder).not.toHaveBeenCalled();
    expect(mockOrderService.cancelOrderByFinance).not.toHaveBeenCalled();
    expect(mockEventBus.publish).not.toHaveBeenCalled();
  });

  it('should skip order that is already ANTREAN (payment succeeded before scheduler ran)', async () => {
    (prisma.stockReservation.findMany as jest.Mock).mockResolvedValue([{ orderId: 'order-1' }]);
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-1',
      orderNumber: 'MLV-20260718-0001',
      status: 'ANTREAN', // Already paid
      customerId: 'customer-1',
    });

    await processor.process({ id: 'job-1' } as any);

    expect(mockOrderService.releaseReservationsForOrder).not.toHaveBeenCalled();
    expect(mockOrderService.cancelOrderByFinance).not.toHaveBeenCalled();
  });

  it('should process multiple orders with expired reservations', async () => {
    (prisma.stockReservation.findMany as jest.Mock).mockResolvedValue([
      { orderId: 'order-1' },
      { orderId: 'order-2' },
    ]);
    (prisma.order.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: 'order-1',
        orderNumber: 'MLV-20260718-0001',
        status: 'MENUNGGU_PEMBAYARAN_DP',
        customerId: 'customer-1',
      })
      .mockResolvedValueOnce({
        id: 'order-2',
        orderNumber: 'MLV-20260718-0002',
        status: 'MENUNGGU_PEMBAYARAN_DP',
        customerId: 'customer-2',
      });
    mockCustomerService.getCustomerByIdInternal
      .mockResolvedValueOnce({ id: 'customer-1', nama: 'Budi', noHp: '+6281' })
      .mockResolvedValueOnce({ id: 'customer-2', nama: 'Sari', noHp: '+6282' });

    await processor.process({ id: 'job-1' } as any);

    expect(mockOrderService.cancelOrderByFinance).toHaveBeenCalledTimes(2);
    expect(mockEventBus.publish).toHaveBeenCalledTimes(2);
  });
});
