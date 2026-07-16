import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
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

/** Hasil login/refresh staff — dipakai controller untuk set httpOnly cookies. */
export interface StaffAuthResult {
  accessToken: string;
  refreshToken: string;
  accessTokenMaxAgeMs: number;
  refreshTokenMaxAgeMs: number;
  user: {
    id: string;
    email: string;
    nama: string;
    role: string;
  };
}

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;
  private readonly accessExpiresIn: string;
  private readonly refreshExpiresDays: number;

  constructor(private readonly config: ConfigService) {
    this.jwtSecret = this.config.getOrThrow<string>('JWT_SECRET');
    this.jwtExpiresIn = this.config.get<string>('JWT_EXPIRES_IN', '7d');
    // Fase 9: staff access token pendek (~1 jam) + refresh token (~7 hari).
    this.accessExpiresIn = this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '1h');
    this.refreshExpiresDays = parseInt(this.config.get<string>('REFRESH_TOKEN_EXPIRES_DAYS', '7'));
  }

  // =====================
  // Internal Staff Login
  // =====================

  async loginStaff(email: string, password: string): Promise<StaffAuthResult> {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Email atau password salah');
    }

    const valid = await comparePassword(password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Email atau password salah');
    }

    return this.issueStaffTokens(user);
  }

  // ==========================================
  // Refresh Token Flow (Fase 9 — §5 keamanan)
  // Token disimpan sebagai hash SHA-256 di DB agar leak DB tidak
  // langsung membocorkan token yang masih berlaku. Refresh = ROTASI:
  // token lama di-revoke, token baru diterbitkan.
  // ==========================================

  async refreshStaffTokens(refreshToken: string | undefined): Promise<StaffAuthResult> {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token tidak ditemukan');
    }

    const tokenHash = this.hashRefreshToken(refreshToken);
    const record = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record) {
      throw new UnauthorizedException('Refresh token tidak valid');
    }

    if (record.revokedAt) {
      // Reuse token yang sudah dirotasi/di-revoke = indikasi pencurian token.
      // Revoke SEMUA sesi user tersebut (fail-closed).
      await prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token sudah tidak berlaku');
    }

    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token sudah kadaluarsa');
    }

    if (!record.user.isActive) {
      throw new UnauthorizedException('User sudah tidak aktif');
    }

    // Rotasi: revoke token lama, terbitkan pasangan token baru
    await prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    return this.issueStaffTokens(record.user);
  }

  async logoutStaff(refreshToken: string | undefined): Promise<{ message: string }> {
    if (refreshToken) {
      const tokenHash = this.hashRefreshToken(refreshToken);
      await prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { message: 'Logout berhasil' };
  }

  private async issueStaffTokens(user: {
    id: string;
    email: string;
    nama: string;
    role: string;
  }): Promise<StaffAuthResult> {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      actorType: ActorType.USER,
      role: user.role as UserRole,
      email: user.email,
    };

    const accessToken = signJwt(payload, this.jwtSecret, this.accessExpiresIn);

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshTokenMaxAgeMs = this.refreshExpiresDays * 24 * 60 * 60 * 1000;

    await prisma.refreshToken.create({
      data: {
        tokenHash: this.hashRefreshToken(refreshToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + refreshTokenMaxAgeMs),
      },
    });

    return {
      accessToken,
      refreshToken,
      accessTokenMaxAgeMs: this.parseExpiresInMs(this.accessExpiresIn),
      refreshTokenMaxAgeMs,
      user: {
        id: user.id,
        email: user.email,
        nama: user.nama,
        role: user.role,
      },
    };
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Parse durasi format jsonwebtoken ('1h', '30m', '7d') ke milidetik. */
  private parseExpiresInMs(expiresIn: string): number {
    const match = /^(\d+)([smhd])$/.exec(expiresIn);
    if (!match) return 60 * 60 * 1000; // fallback 1 jam
    const value = parseInt(match[1]);
    const unit = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }[match[2]]!;
    return value * unit;
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

  /**
   * Batch variant of getUserByIdInternal — single DB call untuk N user.
   * Dipakai InternalChatService.FIX #2: avoid N+1 query per chat message.
   */
  async getUsersByIdsInternal(
    userIds: string[],
  ): Promise<Array<{ id: string; nama: string; role: UserRole }>> {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nama: true, role: true },
    });
    return users.map((u) => ({ id: u.id, nama: u.nama, role: u.role as UserRole }));
  }

  /**
   * Daftar staff aktif (Fase 9 Bagian 2): dipakai portal admin untuk
   * dropdown "assign task ke Tim Penjahit". BUKAN manajemen user penuh
   * (itu Owner-only, modul terpisah) — hanya list minimal tanpa
   * kolom sensitif (password/isActive internal).
   */
  async findStaffUsers(role?: UserRole) {
    // Query param mentah dari HTTP — abaikan nilai yang bukan UserRole valid
    // supaya Prisma tidak melempar error enum.
    const roleFilter = role && Object.values(UserRole).includes(role) ? role : undefined;
    return prisma.user.findMany({
      where: {
        isActive: true,
        ...(roleFilter ? { role: roleFilter } : {}),
      },
      select: { id: true, nama: true, email: true, role: true },
      orderBy: { nama: 'asc' },
    });
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
