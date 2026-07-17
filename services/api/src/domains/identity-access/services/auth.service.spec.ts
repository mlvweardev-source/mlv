import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google-auth.service';
import { EventBusService } from '../../../event-bus/event-bus.service';
import { prisma } from '@mlv/db';
import { comparePassword, compareOtp, verifyJwt, ActorType, UserRole } from '@mlv/auth';

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
      update: jest.fn(),
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
  let eventBus: { publish: jest.Mock };
  let googleAuth: { verifyIdToken: jest.Mock };

  beforeEach(async () => {
    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    googleAuth = { verifyIdToken: jest.fn() };

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
        { provide: EventBusService, useValue: eventBus },
        { provide: GoogleAuthService, useValue: googleAuth },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
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
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('should create OTP and publish auth.otp.requested event (Fase 10 — bukan console.log)', async () => {
      (prisma.otpCode.count as jest.Mock).mockResolvedValue(2);
      (prisma.otpCode.create as jest.Mock).mockResolvedValue({});

      const result = await service.requestOtp('08123456789');

      expect(result).toEqual({
        message: 'Kode OTP telah dikirim via WhatsApp',
        phone: '08123456789',
      });
      expect(prisma.otpCode.create).toHaveBeenCalled();

      // Event dipublish ke EventBus (routing → notification-events),
      // BUKAN panggilan langsung ke Fonnte (boundary Fase 8).
      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      const [eventName, payload] = eventBus.publish.mock.calls[0];
      expect(eventName).toBe('auth.otp.requested');
      expect(payload.customerNoHp).toBe('08123456789');
      expect(payload.kode).toMatch(/^\d{6}$/);
      expect(payload.berlakuMenit).toBe(5);

      // Kode di payload harus sama dengan yang di-hash ke DB (plaintext
      // tidak pernah disimpan).
      const createArg = (prisma.otpCode.create as jest.Mock).mock.calls[0][0];
      expect(createArg.data.codeHash).not.toBe(payload.kode);
    });
  });

  describe('verifyOtp', () => {
    it('should return customer + cookie metadata on valid code (untuk httpOnly cookie)', async () => {
      (prisma.otpCode.findMany as jest.Mock).mockResolvedValue([
        { id: 'otp-1', codeHash: 'hashed', attempts: 0 },
      ]);
      (compareOtp as jest.Mock).mockResolvedValue(true);
      (prisma.otpCode.update as jest.Mock).mockResolvedValue({});
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        nama: 'Budi',
        noHp: '08123456789',
        email: null,
      });

      const result = await service.verifyOtp('08123456789', '123456');

      expect(result.customer).toEqual({
        id: 'cust-1',
        nama: 'Budi',
        noHp: '08123456789',
        email: null,
      });
      expect(result.accessTokenMaxAgeMs).toBeGreaterThan(0);

      const decoded = verifyJwt(result.accessToken, 'super-secret-key-at-least-32-chars-long');
      expect(decoded.sub).toBe('cust-1');
      expect(decoded.actorType).toBe(ActorType.CUSTOMER);
    });
  });

  describe('googleCallback', () => {
    it('should reject when Google verifier rejects the token (fail-closed, tanpa fallback mock)', async () => {
      googleAuth.verifyIdToken.mockRejectedValue(
        new UnauthorizedException('Token Google tidak valid'),
      );

      await expect(service.googleCallback('tampered-token')).rejects.toThrow(UnauthorizedException);
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('should login existing customer matched by googleId (sub)', async () => {
      googleAuth.verifyIdToken.mockResolvedValue({
        sub: 'google-sub-1',
        email: 'budi@gmail.com',
        emailVerified: true,
        nama: 'Budi',
      });
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'cust-1',
        nama: 'Budi',
        noHp: null,
        email: 'budi@gmail.com',
      });

      const result = await service.googleCallback('valid-token');

      expect(result.customer.id).toBe('cust-1');
      expect(prisma.customer.create).not.toHaveBeenCalled();

      const decoded = verifyJwt(result.accessToken, 'super-secret-key-at-least-32-chars-long');
      expect(decoded.sub).toBe('cust-1');
      expect(decoded.actorType).toBe(ActorType.CUSTOMER);
    });

    it('should link Google auth method to existing customer with same VERIFIED email', async () => {
      googleAuth.verifyIdToken.mockResolvedValue({
        sub: 'google-sub-2',
        email: 'siti@example.com',
        emailVerified: true,
        nama: 'Siti',
      });
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue(null); // belum ada googleId
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({
        id: 'cust-2',
        nama: 'Siti',
        noHp: '0811111111',
        email: 'siti@example.com',
      });
      (prisma.customer.update as jest.Mock).mockResolvedValue({
        id: 'cust-2',
        nama: 'Siti',
        noHp: '0811111111',
        email: 'siti@example.com',
      });

      const result = await service.googleCallback('valid-token');

      expect(result.customer.id).toBe('cust-2');
      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cust-2' },
          data: expect.objectContaining({
            googleId: 'google-sub-2',
            authMethods: { create: { tipe: 'GOOGLE', identifier: 'google-sub-2' } },
          }),
        }),
      );
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('should NOT link by email when email is unverified (account-takeover guard) — create new customer', async () => {
      googleAuth.verifyIdToken.mockResolvedValue({
        sub: 'google-sub-3',
        email: 'siti@example.com',
        emailVerified: false,
        nama: 'Fake Siti',
      });
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.customer.create as jest.Mock).mockResolvedValue({
        id: 'cust-3',
        nama: 'Fake Siti',
        noHp: null,
        email: 'siti@example.com',
      });

      const result = await service.googleCallback('valid-token');

      // findUnique by email TIDAK dipanggil karena email tidak terverifikasi
      expect(prisma.customer.findUnique).not.toHaveBeenCalled();
      expect(prisma.customer.create).toHaveBeenCalled();
      expect(result.customer.id).toBe('cust-3');
    });

    it('should auto-create customer + GOOGLE auth method on first login', async () => {
      googleAuth.verifyIdToken.mockResolvedValue({
        sub: 'google-sub-4',
        email: 'baru@gmail.com',
        emailVerified: true,
        nama: 'Pelanggan Baru',
      });
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.customer.create as jest.Mock).mockResolvedValue({
        id: 'cust-4',
        nama: 'Pelanggan Baru',
        noHp: null,
        email: 'baru@gmail.com',
      });

      const result = await service.googleCallback('valid-token');

      expect(prisma.customer.create).toHaveBeenCalledWith({
        data: {
          nama: 'Pelanggan Baru',
          email: 'baru@gmail.com',
          googleId: 'google-sub-4',
          authMethods: {
            create: { tipe: 'GOOGLE', identifier: 'google-sub-4' },
          },
        },
      });
      expect(result.customer.id).toBe('cust-4');
    });
  });
});
