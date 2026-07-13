import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { LoginDto, OtpRequestDto, OtpVerifyDto, GoogleCallbackDto } from '../dto/auth.dto';
import { AuthGuard, Public } from '../guards/auth.guard';
import type { JwtPayload } from '@mlv/auth';

@Controller('auth')
@UseGuards(AuthGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/login — Internal staff login (email + password).
   * Returns JWT access token + user info.
   */
  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.loginStaff(dto.email, dto.password);
  }

  /**
   * POST /auth/otp/request — Request OTP sent to phone number.
   * OTP is logged to console (mock, WhatsApp integration in Fase 8).
   */
  @Public()
  @Post('otp/request')
  async otpRequest(@Body() dto: OtpRequestDto) {
    return this.authService.requestOtp(dto.phone);
  }

  /**
   * POST /auth/otp/verify — Verify OTP code, return JWT.
   * Creates customer account if first login.
   */
  @Public()
  @Post('otp/verify')
  async otpVerify(@Body() dto: OtpVerifyDto) {
    return this.authService.verifyOtp(dto.phone, dto.code);
  }

  /**
   * POST /auth/google/callback — Google OAuth callback.
   * Mock implementation for Fase 1. Real Google token verification in Fase 10.
   */
  @Public()
  @Post('google/callback')
  async googleCallback(@Body() dto: GoogleCallbackDto) {
    return this.authService.googleCallback(dto.idToken);
  }

  /**
   * GET /auth/me — Get current authenticated user/customer info.
   * Requires valid JWT token in Authorization header.
   */
  @Get('me')
  async me(@Req() req: { user: JwtPayload }) {
    return this.authService.getMe(req.user);
  }
}
