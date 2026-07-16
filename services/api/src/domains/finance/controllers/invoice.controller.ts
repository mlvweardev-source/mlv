import { Controller, Get, Param, Post, Query, ParseUUIDPipe } from '@nestjs/common';
import { FinanceService } from '../services/finance.service';
import { Roles } from '../../identity-access/guards/auth.guard';
import { UserRole } from '@mlv/auth';

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
  async findInvoices(@Query('orderId') orderId?: string) {
    return this.financeService.findInvoices(orderId);
  }

  /**
   * GET /invoices/:id
   */
  @Get(':id')
  async getInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.getInvoiceById(id);
  }

  /**
   * GET /invoices/:id/pdf
   */
  @Get(':id/pdf')
  async getInvoicePdf(@Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.getInvoicePdf(id);
  }

  /**
   * POST /invoices/:id/issue
   */
  @Post(':id/issue')
  async issueInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.financeService.issueInvoice(id);
  }
}
