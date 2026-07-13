import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { prisma } from '@mlv/db';
import { comparePassword, verifyJwt, ActorType, UserRole } from '@mlv/auth';

// Mock @mlv/db
jest.mock('@mlv/db', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    otpCode: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    customer: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

// Mock bcrypt comparison
jest.mock('@mlv/auth', () => {
  const original = jest.requireActual('@mlv/auth');
  return {
    ...original,
    comparePassword: jest.fn(),
    compareOtp: jest.fn(),
  };
});

describe('AuthService', () => {
  let service: AuthService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('super-secret-key-at-least-32-chars-long'),
            get: jest.fn().mockReturnValue('7d'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    configService = module.get<ConfigService>(ConfigService);
    jest.clearAllMocks();
  });

  describe('loginStaff', () => {
    it('should throw UnauthorizedException if staff user does not exist', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.loginStaff('nonexistent@mlv.dev', 'password')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if staff user is inactive', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-id',
        email: 'inactive@mlv.dev',
        password: 'hashed-password',
        isActive: false,
      });

      await expect(service.loginStaff('inactive@mlv.dev', 'password')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if password comparison fails', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-id',
        email: 'staff@mlv.dev',
        password: 'hashed-password',
        isActive: true,
        role: UserRole.OWNER,
        nama: 'Staff User',
      });
      (comparePassword as jest.Mock).mockResolvedValue(false);

      await expect(service.loginStaff('staff@mlv.dev', 'wrongpassword')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return token and user info on successful login', async () => {
      const mockUser = {
        id: 'user-id',
        email: 'staff@mlv.dev',
        password: 'hashed-password',
        isActive: true,
        role: UserRole.OWNER,
        nama: 'Staff User',
      };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (comparePassword as jest.Mock).mockResolvedValue(true);

      const result = await service.loginStaff('staff@mlv.dev', 'correctpassword');

      expect(result).toHaveProperty('accessToken');
      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        nama: mockUser.nama,
        role: mockUser.role,
      });

      // Verify the generated token payload
      const decoded = verifyJwt(result.accessToken, 'super-secret-key-at-least-32-chars-long');
      expect(decoded.sub).toBe(mockUser.id);
      expect(decoded.actorType).toBe(ActorType.USER);
      expect(decoded.role).toBe(mockUser.role);
    });
  });

  describe('requestOtp', () => {
    it('should throw BadRequestException if phone has reached OTP rate limit', async () => {
      (prisma.otpCode.count as jest.Mock).mockResolvedValue(5);

      await expect(service.requestOtp('08123456789')).rejects.toThrow(BadRequestException);
    });

    it('should create and log OTP successfully', async () => {
      (prisma.otpCode.count as jest.Mock).mockResolvedValue(2);
      (prisma.otpCode.create as jest.Mock).mockResolvedValue({});

      const result = await service.requestOtp('08123456789');

      expect(result).toEqual({
        message: 'Kode OTP telah dikirim',
        phone: '08123456789',
      });
      expect(prisma.otpCode.create).toHaveBeenCalled();
    });
  });
});
