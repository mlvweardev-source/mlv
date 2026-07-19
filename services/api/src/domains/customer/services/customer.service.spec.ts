import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { prisma } from '@mlv/db';
import { ActorType, UserRole } from '@mlv/auth';

// Mock @mlv/db
jest.mock('@mlv/db', () => ({
  prisma: {
    customer: {
      findUnique: jest.fn(),
      findMany: jest.fn(), // Fase 12 Bagian 2: getCustomersByIdsInternal
      update: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
    },
    review: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

const prismaMock = prisma as any;

describe('CustomerService', () => {
  let service: CustomerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        {
          provide: EventBusService,
          useValue: {
            publish: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
    jest.clearAllMocks();
  });

  describe('findOne', () => {
    it('should throw ForbiddenException if customer requests other customer profile', async () => {
      const actor = { sub: 'customer-1', actorType: ActorType.CUSTOMER };

      await expect(service.findOne('customer-2', actor)).rejects.toThrow(ForbiddenException);
    });

    it('should allow customer to view their own profile', async () => {
      const mockCustomer = { id: 'customer-1', nama: 'Budi' };
      (prismaMock.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);

      const actor = { sub: 'customer-1', actorType: ActorType.CUSTOMER };
      const result = await service.findOne('customer-1', actor);

      expect(result).toEqual(mockCustomer);
    });

    it('should allow staff to view any customer profile', async () => {
      const mockCustomer = { id: 'customer-2', nama: 'Siti' };
      (prismaMock.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);

      const actor = { sub: 'staff-1', actorType: ActorType.USER, role: UserRole.MANAJER_PRODUKSI };
      const result = await service.findOne('customer-2', actor);

      expect(result).toEqual(mockCustomer);
    });

    it('should throw NotFoundException if customer does not exist', async () => {
      (prismaMock.customer.findUnique as jest.Mock).mockResolvedValue(null);

      const actor = { sub: 'staff-1', actorType: ActorType.USER, role: UserRole.OWNER };
      await expect(service.findOne('nonexistent', actor)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createReview', () => {
    it('should create review and save it in database', async () => {
      const actor = { sub: 'customer-1', actorType: ActorType.CUSTOMER };
      const mockCustomer = { id: 'customer-1', nama: 'Budi' };
      const mockReview = { id: 'review-1', customerId: 'customer-1', rating: 5, komentar: 'Bagus' };

      (prismaMock.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);
      (prismaMock.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        customerId: 'customer-1',
        status: 'DIKIRIM',
      });
      (prismaMock.review.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.review.create as jest.Mock).mockResolvedValue(mockReview);

      const result = await service.createReview(
        'customer-1',
        { rating: 5, komentar: 'Bagus', orderId: 'order-1' },
        actor,
      );

      expect(result).toEqual(mockReview);
      expect(prismaMock.review.create).toHaveBeenCalledWith({
        data: {
          customerId: 'customer-1',
          rating: 5,
          komentar: 'Bagus',
          orderId: 'order-1',
        },
      });
    });

    it('should reject review before order is DIKIRIM', async () => {
      const actor = { sub: 'customer-1', actorType: ActorType.CUSTOMER };
      (prismaMock.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'customer-1' });
      (prismaMock.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        customerId: 'customer-1',
        status: 'SEWING',
      });

      await expect(
        service.createReview(
          'customer-1',
          { rating: 4, komentar: 'Belum selesai', orderId: 'order-1' },
          actor,
        ),
      ).rejects.toThrow('Review hanya dapat diberikan setelah order berstatus DIKIRIM');
    });

    it('should reject a second review for the same order', async () => {
      const actor = { sub: 'customer-1', actorType: ActorType.CUSTOMER };
      (prismaMock.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'customer-1' });
      (prismaMock.order.findUnique as jest.Mock).mockResolvedValue({
        id: 'order-1',
        customerId: 'customer-1',
        status: 'DIKIRIM',
      });
      (prismaMock.review.findFirst as jest.Mock).mockResolvedValue({ id: 'review-1' });

      await expect(
        service.createReview(
          'customer-1',
          { rating: 5, komentar: 'Bagus', orderId: 'order-1' },
          actor,
        ),
      ).rejects.toThrow('Review untuk order ini sudah pernah diberikan');
    });

    it('should throw ForbiddenException if staff tries to create customer review', async () => {
      const actor = { sub: 'staff-1', actorType: ActorType.USER, role: UserRole.OWNER };

      await expect(
        service.createReview(
          'customer-1',
          { rating: 5, komentar: 'Bagus', orderId: 'order-1' },
          actor,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  /**
   * Fase 12 Bagian 2 (koreksi DDD §4.1):
   * getCustomersByIdsInternal = method batch untuk caller lintas domain
   * yang butuh resolve banyak nama customer sekaligus (anti N+1).
   * Pola sama dengan getUsersByIdsInternal di AuthService.
   */
  describe('getCustomersByIdsInternal (Fase 12 Bagian 2 — cross-domain batch)', () => {
    it('should return Map keyed by customerId with id+nama', async () => {
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue([
        { id: 'cust-1', nama: 'Andi' },
        { id: 'cust-2', nama: 'Budi' },
      ]);

      const result = await service.getCustomersByIdsInternal(['cust-1', 'cust-2']);

      expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['cust-1', 'cust-2'] } },
        select: { id: true, nama: true },
      });
      expect(result.get('cust-1')?.nama).toBe('Andi');
      expect(result.get('cust-2')?.nama).toBe('Budi');
      expect(result.size).toBe(2);
    });

    it('should return empty Map when no ids given', async () => {
      const result = await service.getCustomersByIdsInternal([]);
      expect(result.size).toBe(0);
      expect(prismaMock.customer.findMany).not.toHaveBeenCalled();
    });

    it('should silently skip customers that do not exist', async () => {
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue([
        { id: 'cust-1', nama: 'Andi' },
        // cust-2 not in result — e.g. deleted account
      ]);

      const result = await service.getCustomersByIdsInternal(['cust-1', 'cust-2']);

      expect(result.size).toBe(1);
      expect(result.get('cust-1')?.nama).toBe('Andi');
      expect(result.has('cust-2')).toBe(false);
    });
  });
});
