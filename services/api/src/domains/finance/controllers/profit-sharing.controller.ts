import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Headers,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FinanceService } from '../services/finance.service';
import { CreateProfitSharingDto, UpdateProfitSharingDto } from '../dto/finance.dto';
import type { JwtPayload } from '@mlv/auth';

@Controller('profit-sharing')
export class ProfitSharingController {
  constructor(private readonly financeService: FinanceService) {}

  /**
   * GET /profit-sharing — Semua profit sharing (Owner only)
   */
  @Get()
  async getProfitSharing(@Headers('x-user') userJson: string) {
    const actor: JwtPayload = JSON.parse(userJson || '{}');
    return this.financeService.getProfitSharing(actor);
  }

  /**
   * POST /profit-sharing — Tambah profit sharing (Owner only)
   */
  @Post()
  async createProfitSharing(
    @Body() dto: CreateProfitSharingDto,
    @Headers('x-user') userJson: string,
  ) {
    const actor: JwtPayload = JSON.parse(userJson || '{}');
    return this.financeService.createProfitSharing(dto, actor);
  }

  /**
   * PATCH /profit-sharing/:id — Update profit sharing (Owner only)
   */
  @Patch(':id')
  async updateProfitSharing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProfitSharingDto,
    @Headers('x-user') userJson: string,
  ) {
    const actor: JwtPayload = JSON.parse(userJson || '{}');
    return this.financeService.updateProfitSharing(id, dto, actor);
  }

  /**
   * DELETE /profit-sharing/:id — Hapus profit sharing (Owner only)
   */
  @Delete(':id')
  async deleteProfitSharing(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-user') userJson: string,
  ) {
    const actor: JwtPayload = JSON.parse(userJson || '{}');
    return this.financeService.deleteProfitSharing(id, actor);
  }
}
