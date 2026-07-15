import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@mlv/db';
import {
  signJwt,
  comparePassword,
  hashPassword,
  hashOtp,
  compareOtp,
  ActorType,
  UserRole,
} from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;

  constructor(private readonly config: ConfigService) {
    this.jwtSecret = this.config.getOrThrow<string>('JWT_SECRET');
    this.jwtExpiresIn = this.config.get<string>('JWT_EXPIRES_IN', '7d');
  }

  // =====================
  // Internal Staff Login
  // =====================

  async loginStaff(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Email atau password salah');
    }

    const valid = await comparePassword(password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Email atau password salah');
    }

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      actorType: ActorType.USER,
      role: user.role as UserRole,
      email: user.email,
    };

    const token = signJwt(payload, this.jwtSecret, this.jwtExpiresIn);

    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        nama: user.nama,
        role: user.role,
      },
    };
  }

  // =====================
  // OTP Flow (Pelanggan)
  // =====================

  async requestOtp(phone: string) {
    // Rate-limit: max 5 pending OTPs per phone in last 10 minutes
    const recentOtps = await prisma.otpCode.count({
      where: {
        phone,
        isUsed: false,
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
      },
    });

    if (recentOtps >= 5) {
      throw new BadRequestException('Terlalu banyak permintaan OTP. Coba lagi nanti.');
    }

    // Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await hashOtp(code);

    await prisma.otpCode.create({
      data: {
        phone,
        codeHash,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      },
    });

    // Mock: log ke console (WhatsApp integration di Fase 8)
    console.log(`[OTP MOCK] Kode OTP untuk ${phone}: ${code}`);

    return { message: 'Kode OTP telah dikirim', phone };
  }

  async verifyOtp(phone: string, code: string) {
    const otpRecords = await prisma.otpCode.findMany({
      where: {
        phone,
        isUsed: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (otpRecords.length === 0) {
      throw new UnauthorizedException('Kode OTP tidak valid atau sudah kadaluarsa');
    }

    let matched = false;
    let matchedOtpId: string | null = null;

    for (const otp of otpRecords) {
      if (otp.attempts >= 3) continue;

      const valid = await compareOtp(code, otp.codeHash);
      if (valid) {
        matched = true;
        matchedOtpId = otp.id;
        break;
      }

      // Increment attempts for wrong code
      await prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: otp.attempts + 1 },
      });
    }

    if (!matched || !matchedOtpId) {
      throw new UnauthorizedException('Kode OTP tidak valid');
    }

    // Mark OTP as used
    await prisma.otpCode.update({
      where: { id: matchedOtpId },
      data: { isUsed: true },
    });

    // Find or create customer
    let customer = await prisma.customer.findFirst({
      where: { noHp: phone },
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          nama: phone, // default name = phone, can be updated later
          noHp: phone,
          authMethods: {
            create: {
              tipe: 'OTP_HP',
              identifier: phone,
            },
          },
        },
      });
    }

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: customer.id,
      actorType: ActorType.CUSTOMER,
    };

    const token = signJwt(payload, this.jwtSecret, this.jwtExpiresIn);

    return {
      accessToken: token,
      customer: {
        id: customer.id,
        nama: customer.nama,
        noHp: customer.noHp,
      },
    };
  }

  // =====================
  // Google OAuth Callback
  // =====================

  async googleCallback(idToken: string) {
    // TODO: Fase 1 — mock implementation.
    // Production: verify idToken with Google APIs, extract sub/email/name.
    // For now, we validate the token is not empty and return a mock response.
    // Actual Google token verification will be connected in Fase 10 (Customer Portal).

    if (!idToken || idToken.length < 10) {
      throw new BadRequestException(
        'Invalid Google ID token. Provide a valid token from Google Sign-In.',
      );
    }

    // Mock: treat idToken as a pseudo Google sub ID for development
    const mockGoogleId = `google_${idToken.substring(0, 20)}`;
    const mockEmail = `${mockGoogleId}@mock.mlv.dev`;

    let customer = await prisma.customer.findFirst({
      where: { googleId: mockGoogleId },
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          nama: mockGoogleId,
          email: mockEmail,
          googleId: mockGoogleId,
          authMethods: {
            create: {
              tipe: 'GOOGLE',
              identifier: mockGoogleId,
            },
          },
        },
      });
    }

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: customer.id,
      actorType: ActorType.CUSTOMER,
      email: customer.email ?? undefined,
    };

    const token = signJwt(payload, this.jwtSecret, this.jwtExpiresIn);

    return {
      accessToken: token,
      customer: {
        id: customer.id,
        nama: customer.nama,
        email: customer.email,
      },
    };
  }

  // =====================
  // Get Current User/Customer
  // =====================

  async getMe(payload: JwtPayload) {
    if (payload.actorType === ActorType.USER) {
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, nama: true, role: true, isActive: true },
      });
      if (!user || !user.isActive) {
        throw new UnauthorizedException('User tidak ditemukan atau sudah tidak aktif');
      }
      return { actorType: ActorType.USER, ...user };
    }

    const customer = await prisma.customer.findUnique({
      where: { id: payload.sub },
      select: { id: true, nama: true, noHp: true, email: true, alamat: true },
    });
    if (!customer) {
      throw new UnauthorizedException('Pelanggan tidak ditemukan');
    }
    return { actorType: ActorType.CUSTOMER, ...customer };
  }

  // ==========================================
  // Cross-Domain: Get User Data (DDD Boundary §4.1)
  // ==========================================
  // Domain lain memanggil method ini untuk mengambil nama staff SEBELUM
  // publish event (payload event harus lengkap — prinsip Fase 8).
  // Domain lain TIDAK BOLEH query prisma.user.findUnique() langsung.

  /**
   * Ambil data user (staff) minimal untuk payload event.
   *
   * @param userId - ID user staff
   * @returns { id, nama, role } atau null jika tidak ada
   */
  async getUserByIdInternal(userId: string): Promise<{
    id: string;
    nama: string;
    role: UserRole;
  } | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, nama: true, role: true },
    });

    return user ? { id: user.id, nama: user.nama, role: user.role as UserRole } : null;
  }

  // =====================
  // Seed helper (for dev)
  // =====================

  async seedStaffUser(email: string, password: string, nama: string, role: UserRole) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return existing;

    const hashed = await hashPassword(password);
    return prisma.user.create({
      data: { email, password: hashed, nama, role },
    });
  }
}
