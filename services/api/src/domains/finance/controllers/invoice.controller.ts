import { Controller, Get, Param, Post, ParseUUIDPipe } from '@nestjs/common';
import { FinanceService } from '../services/finance.service';

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly financeService: FinanceService) {}

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
