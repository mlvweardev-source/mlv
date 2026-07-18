import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FinanceService } from '../services/finance.service';
import { CreatePaymentDto } from '../dto/finance.dto';
import { Public, Roles, GetUser, AllowCustomer } from '../../identity-access/guards/auth.guard';
import { UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';

/**
 * Payment endpoints — §8.
 *
 * RBAC (Fase 9.3): actor dari @GetUser() (payload JWT terverifikasi
 * AuthGuard) — BUKAN header `x-user` yang bisa dipalsukan client.
 * §5.1 + keputusan Fase 9.3: buat link pembayaran = aksi operasional dari
 * halaman Order (Owner & Manajer); halaman /finance = view-only.
 */
@Controller('payments')
@Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
export class PaymentController {
  constructor(private readonly financeService: FinanceService) {}

  /**
   * POST /payments — Buat payment + inisiasi Midtrans
   */
  @Post()
  @AllowCustomer()
  async createPayment(@Body() dto: CreatePaymentDto, @GetUser() actor: JwtPayload) {
    return this.financeService.createPayment(dto, actor);
  }

  /**
   * GET /payments — Daftar payment (filter opsional ?orderId=)
   */
  @Get()
  @AllowCustomer()
  async findPayments(@Query('orderId') orderId: string | undefined, @GetUser() actor: JwtPayload) {
    return this.financeService.findPayments(orderId, actor);
  }

  /**
   * POST /payments/webhook/midtrans — Webhook dari Midtrans
   * Public endpoint - signature verification dilakukan di service
   */
  @Post('webhook/midtrans')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: any,
    @Headers('x-midtrans-signature-key') signatureKey: string,
  ) {
    await this.financeService.handleMidtransWebhook(payload, signatureKey);
    return { received: true };
  }

  /**
   * GET /payments/:id
   */
  @Get(':id')
  async getPayment(@Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.getPaymentById(id);
  }
}
