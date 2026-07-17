import { Controller, Post, Get, Body, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import type { StaffAuthResult, CustomerAuthResult } from '../services/auth.service';
import { LoginDto, OtpRequestDto, OtpVerifyDto, GoogleCallbackDto } from '../dto/auth.dto';
import { AuthGuard, Public, Roles } from '../guards/auth.guard';
import type { JwtPayload } from '@mlv/auth';
import { UserRole } from '@mlv/auth';

// Nama cookie httpOnly untuk staff portal (Fase 9).
// Token TIDAK dikirim di response body — mitigasi XSS (§5 keamanan).
export const ACCESS_TOKEN_COOKIE = 'mlv_access_token';
export const REFRESH_TOKEN_COOKIE = 'mlv_refresh_token';
// Cookie pelanggan (Fase 10 — apps/web). TERPISAH dari cookie staff:
// di dev semua app share host localhost, tidak boleh saling menimpa.
export const CUSTOMER_TOKEN_COOKIE = 'mlv_customer_token';

@Controller('auth')
@UseGuards(AuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/login — Internal staff login (email + password).
   * Set access token (~1 jam) + refresh token (~7 hari) sebagai httpOnly cookie.
   * Response body hanya berisi info user, TANPA token.
   */
  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.loginStaff(dto.email, dto.password);
    this.setAuthCookies(res, result);
    return { user: result.user };
  }

  /**
   * POST /auth/refresh — Terbitkan access token baru dari refresh token cookie.
   * Refresh token dirotasi: yang lama di-revoke, yang baru di-set sebagai cookie.
   */
  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = this.readCookie(req, REFRESH_TOKEN_COOKIE);
    const result = await this.authService.refreshStaffTokens(refreshToken);
    this.setAuthCookies(res, result);
    return { user: result.user };
  }

  /**
   * POST /auth/logout — Revoke refresh token di DB + clear kedua cookie.
   */
  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = this.readCookie(req, REFRESH_TOKEN_COOKIE);
    const result = await this.authService.logoutStaff(refreshToken);
    res.clearCookie(ACCESS_TOKEN_COOKIE, this.cookieOptions());
    res.clearCookie(REFRESH_TOKEN_COOKIE, this.cookieOptions());
    return result;
  }

  /**
   * POST /auth/otp/request — Request OTP ke nomor HP pelanggan.
   * Fase 10: kode dikirim via WhatsApp (event auth.otp.requested →
   * queue notification-events → FonnteChannel di services/notification).
   */
  @Public()
  @Post('otp/request')
  async otpRequest(@Body() dto: OtpRequestDto) {
    return this.authService.requestOtp(dto.phone);
  }

  /**
   * POST /auth/otp/verify — Verifikasi kode OTP.
   * Sukses: set httpOnly cookie `mlv_customer_token` (pola sama dengan
   * staff portal — token TIDAK di body). Akun dibuat otomatis saat
   * login pertama.
   */
  @Public()
  @Post('otp/verify')
  async otpVerify(@Body() dto: OtpVerifyDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.verifyOtp(dto.phone, dto.code);
    this.setCustomerCookie(res, result);
    return { customer: result.customer };
  }

  /**
   * POST /auth/google/callback — Login/registrasi via Google (Fase 10).
   * id_token dari Google Identity Services diverifikasi ke Google
   * (signature + audience) — mock Fase 1 sudah DICABUT.
   * Sukses: set httpOnly cookie `mlv_customer_token`.
   */
  @Public()
  @Post('google/callback')
  async googleCallback(@Body() dto: GoogleCallbackDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.googleCallback(dto.idToken);
    this.setCustomerCookie(res, result);
    return { customer: result.customer };
  }

  /**
   * POST /auth/customer/logout — Hapus cookie sesi pelanggan (Fase 10).
   * JWT pelanggan stateless (tanpa refresh token) — cukup clear cookie.
   */
  @Public()
  @Post('customer/logout')
  customerLogout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(CUSTOMER_TOKEN_COOKIE, this.cookieOptions());
    return { message: 'Logout berhasil' };
  }

  /**
   * GET /auth/me — Get current authenticated user/customer info.
   * Token dibaca dari httpOnly cookie (staff portal) atau Authorization header.
   */
  @Get('me')
  async me(@Req() req: { user: JwtPayload }) {
    return this.authService.getMe(req.user);
  }

  /**
   * GET /auth/users — Daftar staff aktif (Fase 9 Bagian 2).
   * Dipakai portal untuk dropdown assign task (?role=TIM_PENJAHIT).
   * Owner & Manajer Produksi saja — bukan manajemen user penuh (Owner-only, nanti).
   */
  @Get('users')
  @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
  async listStaffUsers(@Query('role') role?: UserRole) {
    return this.authService.findStaffUsers(role);
  }

  // ==========================================
  // Cookie helpers
  // ==========================================

  private setAuthCookies(res: Response, result: StaffAuthResult) {
    res.cookie(ACCESS_TOKEN_COOKIE, result.accessToken, {
      ...this.cookieOptions(),
      maxAge: result.accessTokenMaxAgeMs,
    });
    // Path '/' (bukan '/auth') supaya middleware apps/admin bisa membaca
    // refresh token dan melakukan auto-refresh saat access token expired.
    res.cookie(REFRESH_TOKEN_COOKIE, result.refreshToken, {
      ...this.cookieOptions(),
      maxAge: result.refreshTokenMaxAgeMs,
    });
  }

  private setCustomerCookie(res: Response, result: CustomerAuthResult) {
    res.cookie(CUSTOMER_TOKEN_COOKIE, result.accessToken, {
      ...this.cookieOptions(),
      maxAge: result.accessTokenMaxAgeMs,
    });
  }

  private cookieOptions(path = '/') {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path,
    };
  }

  private readCookie(req: Request, name: string): string | undefined {
    return (req as Request & { cookies?: Record<string, string> }).cookies?.[name];
  }
}
