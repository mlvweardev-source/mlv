import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FinanceService } from '../services/finance.service';
import { CreateApprovalDto, DecideApprovalDto } from '../dto/finance.dto';
import type { JwtPayload } from '@mlv/auth';

@Controller('approvals')
export class ApprovalController {
  constructor(private readonly financeService: FinanceService) {}

  /**
   * GET /approvals
   */
  @Get()
  async getApprovals(@Query('status') status?: string) {
    return this.financeService.getApprovals(status);
  }

  /**
   * POST /approvals — Ajukan approval request
   * Hanya Manajer Produksi
   */
  @Post()
  async createApproval(
    @Body() dto: CreateApprovalDto,
    @Headers('x-user') userJson: string,
  ) {
    const actor: JwtPayload = JSON.parse(userJson || '{}');
    return this.financeService.createApproval(dto, actor);
  }

  /**
   * PATCH /approvals/:id/decide — Putuskan approval
   * Hanya Owner
   */
  @Patch(':id/decide')
  async decideApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideApprovalDto,
    @Headers('x-user') userJson: string,
  ) {
    const actor: JwtPayload = JSON.parse(userJson || '{}');
    return this.financeService.decideApproval(id, dto, actor);
  }
}
