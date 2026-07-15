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
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
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
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({});

      const result = await service.loginStaff('staff@mlv.dev', 'correctpassword');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        nama: mockUser.nama,
        role: mockUser.role,
      });

      // Refresh token disimpan sebagai HASH, bukan plain text
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
      const createArg = (prisma.refreshToken.create as jest.Mock).mock.calls[0][0];
      expect(createArg.data.tokenHash).not.toBe(result.refreshToken);
      expect(createArg.data.userId).toBe(mockUser.id);

      // Verify the generated token payload
      const decoded = verifyJwt(result.accessToken, 'super-secret-key-at-least-32-chars-long');
      expect(decoded.sub).toBe(mockUser.id);
      expect(decoded.actorType).toBe(ActorType.USER);
      expect(decoded.role).toBe(mockUser.role);
    });
  });

  describe('refreshStaffTokens', () => {
    const mockUser = {
      id: 'user-id',
      email: 'staff@mlv.dev',
      nama: 'Staff User',
      role: UserRole.OWNER,
      isActive: true,
    };

    it('should throw UnauthorizedException if refresh token is missing', async () => {
      await expect(service.refreshStaffTokens(undefined)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if refresh token is unknown', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.refreshStaffTokens('unknown-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should revoke ALL user sessions when a revoked token is reused', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
        id: 'rt-1',
        userId: mockUser.id,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000000),
        user: mockUser,
      });

      await expect(service.refreshStaffTokens('stolen-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('should throw UnauthorizedException if refresh token is expired', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
        id: 'rt-1',
        userId: mockUser.id,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user: mockUser,
      });

      await expect(service.refreshStaffTokens('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should rotate refresh token and issue new tokens on success', async () => {
      (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
        id: 'rt-1',
        userId: mockUser.id,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000000),
        user: mockUser,
      });
      (prisma.refreshToken.update as jest.Mock).mockResolvedValue({});
      (prisma.refreshToken.create as jest.Mock).mockResolvedValue({});

      const result = await service.refreshStaffTokens('valid-token');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      // Token lama di-revoke (rotasi)
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) },
      });
      // Token baru dibuat
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('logoutStaff', () => {
    it('should revoke the refresh token in DB', async () => {
      (prisma.refreshToken.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await service.logoutStaff('some-token');

      expect(result).toEqual({ message: 'Logout berhasil' });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: expect.any(String), revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('should succeed silently without a refresh token', async () => {
      const result = await service.logoutStaff(undefined);

      expect(result).toEqual({ message: 'Logout berhasil' });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
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
