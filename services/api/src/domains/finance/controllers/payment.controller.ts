import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  Headers,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FinanceService } from '../services/finance.service';
import { CreatePaymentDto } from '../dto/finance.dto';
import { Public } from '../../identity-access/guards/auth.guard';
import type { JwtPayload } from '@mlv/auth';

@Controller('payments')
export class PaymentController {
  constructor(private readonly financeService: FinanceService) {}

  /**
   * POST /payments — Buat payment + inisiasi Midtrans
   */
  @Post()
  async createPayment(
    @Body() dto: CreatePaymentDto,
    @Headers('x-user') userJson: string,
  ) {
    const actor: JwtPayload = JSON.parse(userJson || '{}');
    return this.financeService.createPayment(dto, actor);
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
