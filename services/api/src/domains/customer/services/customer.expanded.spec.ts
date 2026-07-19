import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { ActorType, UserRole } from '@mlv/auth';
import { prisma } from '@mlv/db';

jest.mock('@mlv/db', () => ({
  prisma: {
    customer: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    review: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    order: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
  },
}));

describe('CustomerService — Expanded Coverage', () => {
  let service: CustomerService;
  const mockEventBus = { publish: jest.fn() };

  const actorCustomer = {
    sub: 'cust-1',
    actorType: ActorType.CUSTOMER,
  } as any;
  const actorOwner = {
    sub: 'owner-1',
    role: 'OWNER',
    actorType: ActorType.USER,
  } as any;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: EventBusService, useValue: mockEventBus },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
  });

  describe('findOne', () => {
    it('should throw NotFoundException when customer not found', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne('nonexistent', actorOwner)).rejects.toThrow(NotFoundException);
    });

    it('should allow staff to access any customer', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'cust-1', nama: 'Customer 1' });
      const result = await service.findOne('cust-1', actorOwner);
      expect(result.id).toBe('cust-1');
    });

    it('should deny customer accessing another customer data', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'cust-2', nama: 'Other' });
      await expect(service.findOne('cust-2', actorCustomer)).rejects.toThrow(ForbiddenException);
    });

    it('should allow customer to access own data', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'cust-1', nama: 'My Profile' });
      const result = await service.findOne('cust-1', actorCustomer);
      expect(result.id).toBe('cust-1');
    });
  });

  describe('update', () => {
    it('should deny customer updating another customer', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'cust-2' });
      await expect(service.update('cust-2', { nama: 'New Name' }, actorCustomer)).rejects.toThrow(ForbiddenException);
    });

    it('should update customer and publish event', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'cust-1', nama: 'Old Name' });
      (prisma.customer.update as jest.Mock).mockResolvedValue({ id: 'cust-1', nama: 'New Name' });

      const result = await service.update('cust-1', { nama: 'New Name' }, actorCustomer);
      expect(result.nama).toBe('New Name');
      expect(mockEventBus.publish).toHaveBeenCalled();
    });

    it('should allow staff to update any customer', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'cust-1' });
      (prisma.customer.update as jest.Mock).mockResolvedValue({ id: 'cust-1', nama: 'Updated' });

      const result = await service.update('cust-1', { nama: 'Updated' }, actorOwner);
      expect(result.nama).toBe('Updated');
    });
  });

  describe('findOrders', () => {
    it('should deny customer accessing another customer orders', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'cust-2' });
      await expect(service.findOrders('cust-2', actorCustomer)).rejects.toThrow(ForbiddenException);
    });

    it('should return orders object for customer', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'cust-1', nama: 'Customer 1' });
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        { id: 'o-1', orderNumber: 'MLV-0001', status: 'DRAFT', deadline: null, createdAt: new Date(), _count: { items: 2 } },
      ]);

      const result = await service.findOrders('cust-1', actorCustomer);
      expect(result.orders).toHaveLength(1);
      expect(result.orders[0].itemCount).toBe(2);
      expect(result.totalOrders).toBe(1);
    });

    it('should allow staff to access any customer orders', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'cust-1', nama: 'Customer 1' });
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.findOrders('cust-1', actorOwner);
      expect(result.orders).toHaveLength(0);
    });
  });

  describe('createReview', () => {
    const reviewDto = { orderId: 'o-1', rating: 5, komentar: 'Great!' };

    it('should deny non-customer from creating review', async () => {
      await expect(service.createReview('cust-1', reviewDto, actorOwner)).rejects.toThrow(ForbiddenException);
    });

    it('should deny customer reviewing another customer order', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({ id: 'o-1', customerId: 'other-customer', status: 'DIKIRIM' });
      await expect(service.createReview('cust-1', reviewDto, actorCustomer)).rejects.toThrow(ForbiddenException);
    });

    it('should throw when order is not DIKIRIM', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({ id: 'o-1', customerId: 'cust-1', status: 'ANTREAN' });
      await expect(service.createReview('cust-1', reviewDto, actorCustomer)).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException for duplicate review', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({ id: 'o-1', customerId: 'cust-1', status: 'DIKIRIM' });
      (prisma.review.findFirst as jest.Mock).mockResolvedValue({ id: 'existing-review' });
      await expect(service.createReview('cust-1', reviewDto, actorCustomer)).rejects.toThrow(ConflictException);
    });

    it('should create review successfully', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue({ id: 'o-1', customerId: 'cust-1', status: 'DIKIRIM' });
      (prisma.review.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.review.create as jest.Mock).mockResolvedValue({ id: 'review-1', rating: 5, komentar: 'Great!' });

      const result = await service.createReview('cust-1', reviewDto, actorCustomer);
      expect(result.rating).toBe(5);
    });

    it('should throw NotFoundException when customer not found (for customer actor)', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.createReview('cust-1', reviewDto, actorCustomer)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCustomerByIdInternal', () => {
    it('should return customer when found', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'cust-1', nama: 'Customer 1', noHp: '081234', email: null });
      const result = await service.getCustomerByIdInternal('cust-1');
      expect(result!.nama).toBe('Customer 1');
    });

    it('should return null when not found', async () => {
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await service.getCustomerByIdInternal('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getCustomersByIdsInternal', () => {
    it('should return map of customer id to object', async () => {
      (prisma.customer.findMany as jest.Mock).mockResolvedValue([
        { id: 'c1', nama: 'Alice' },
        { id: 'c2', nama: 'Bob' },
      ]);

      const result = await service.getCustomersByIdsInternal(['c1', 'c2']);
      expect(result.get('c1')!.nama).toBe('Alice');
      expect(result.get('c2')!.nama).toBe('Bob');
    });

    it('should return empty map for empty input', async () => {
      const result = await service.getCustomersByIdsInternal([]);
      expect(result.size).toBe(0);
      expect(prisma.customer.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getRepeatCustomerRate', () => {
    it('should return 0 rate when no orders', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getRepeatCustomerRate(new Date(), new Date());
      expect(result.totalActive).toBe(0);
      expect(result.repeatCount).toBe(0);
      expect(result.rate).toBe(0);
    });

    it('should calculate repeat customer rate', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        { customerId: 'c1' }, { customerId: 'c1' }, { customerId: 'c1' },
        { customerId: 'c2' }, { customerId: 'c2' },
        { customerId: 'c3' },
      ]);

      const result = await service.getRepeatCustomerRate(new Date(), new Date());
      expect(result.totalActive).toBe(3); // 3 unique customers
      expect(result.repeatCount).toBe(2); // c1 and c2 have >1 orders
      expect(result.rate).toBeCloseTo(2 / 3);
    });
  });
});
