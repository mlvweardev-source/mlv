import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { prisma } from '@mlv/db';
import { ActorType, UserRole } from '@mlv/auth';

// Mock @mlv/db
jest.mock('@mlv/db', () => ({
  prisma: {
    customer: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    review: {
      create: jest.fn(),
    },
  },
}));

describe('CustomerService', () => {
  let service: CustomerService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    jest.clearAllMocks();
  });

  describe('findOne', () => {
    it('should throw ForbiddenException if customer requests other customer profile', async () => {
      const actor = { sub: 'customer-1', actorType: ActorType.CUSTOMER };

      await expect(service.findOne('customer-2', actor)).rejects.toThrow(ForbiddenException);
    });

    it('should allow customer to view their own profile', async () => {
      const mockCustomer = { id: 'customer-1', nama: 'Budi' };
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);

      const actor = { sub: 'customer-1', actorType: ActorType.CUSTOMER };
      const result = await service.findOne('customer-1', actor);

      expect(result).toEqual(mockCustomer);
    });

    it('should allow staff to view any customer profile', async () => {
      const mockCustomer = { id: 'customer-2', nama: 'Siti' };
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);

      const actor = { sub: 'staff-1', actorType: ActorType.USER, role: UserRole.MANAJER_PRODUKSI };
      const result = await service.findOne('customer-2', actor);

      expect(result).toEqual(mockCustomer);
    });

    it('should throw NotFoundException if customer does not exist', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);

      const actor = { sub: 'staff-1', actorType: ActorType.USER, role: UserRole.OWNER };
      await expect(service.findOne('nonexistent', actor)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createReview', () => {
    it('should create review and save it in database', async () => {
      const actor = { sub: 'customer-1', actorType: ActorType.CUSTOMER };
      const mockCustomer = { id: 'customer-1', nama: 'Budi' };
      const mockReview = { id: 'review-1', customerId: 'customer-1', rating: 5, komentar: 'Bagus' };

      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(mockCustomer);
      (prisma.review.create as jest.Mock).mockResolvedValue(mockReview);

      const result = await service.createReview(
        'customer-1',
        { rating: 5, komentar: 'Bagus' },
        actor,
      );

      expect(result).toEqual(mockReview);
      expect(prisma.review.create).toHaveBeenCalledWith({
        data: {
          customerId: 'customer-1',
          rating: 5,
          komentar: 'Bagus',
          orderId: null,
        },
      });
    });

    it('should throw ForbiddenException if staff tries to create customer review', async () => {
      const actor = { sub: 'staff-1', actorType: ActorType.USER, role: UserRole.OWNER };

      await expect(
        service.createReview('customer-1', { rating: 5, komentar: 'Bagus' }, actor),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
