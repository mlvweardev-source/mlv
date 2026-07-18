import { Controller, Get, Param, Post, Query, ParseUUIDPipe } from '@nestjs/common';
import { FinanceService } from '../services/finance.service';
import { AllowCustomer, GetUser, Roles } from '../../identity-access/guards/auth.guard';
import { UserRole } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';

/**
 * Invoice endpoints — §8.
 * §5.1: Finance (Payment/Invoice) — Owner full, Manajer view + issue
 * (issue invoice = bagian alur operasional harian).
 */
@Controller('invoices')
@Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
export class InvoiceController {
  constructor(private readonly financeService: FinanceService) {}

  /**
   * GET /invoices — Daftar invoice (filter opsional ?orderId=)
   */
  @Get()
  @AllowCustomer()
  async findInvoices(@Query('orderId') orderId: string | undefined, @GetUser() actor: JwtPayload) {
    return this.financeService.findInvoices(orderId, actor);
  }

  /**
   * GET /invoices/:id
   */
  @Get(':id')
  @AllowCustomer()
  async getInvoice(@Param('id', ParseUUIDPipe) id: string, @GetUser() actor: JwtPayload) {
    return this.financeService.getInvoiceById(id, actor);
  }

  /**
   * GET /invoices/:id/pdf
   */
  @Get(':id/pdf')
  @AllowCustomer()
  async getInvoicePdf(@Param('id', ParseUUIDPipe) id: string, @GetUser() actor: JwtPayload) {
    return this.financeService.getInvoicePdf(id, actor);
  }

  /**
   * POST /invoices/:id/issue
   */
  @Post(':id/issue')
  async issueInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.issueInvoice(id);
  }
}
