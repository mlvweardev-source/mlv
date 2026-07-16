import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { JwtPayload } from '@mlv/auth';
import { UserRole } from '@mlv/auth';
import { AuthGuard, Roles } from '../../identity-access/guards/auth.guard';
import { GetUser } from '../../identity-access/guards/auth.guard';
import { ProductionService } from '../services/production.service';
import { GetTasksQueryDto, UpdateTaskStatusDto, AssignTaskDto } from '../dto/production.dto';

/**
 * Production Domain Controller
 *
 * Endpoints sesuai §8:
 * - GET    /production/routings/:productType
 * - GET    /production/tasks
 * - PATCH  /production/tasks/:id/status
 * - POST   /production/tasks/:id/assign
 */
@Controller('production')
@UseGuards(AuthGuard)
// §5.1: Production Domain = staff internal saja (Owner/Manajer full,
// Penjahit task miliknya — difilter per-endpoint di bawah). Tanpa @Roles
// class-level, customer ber-JWT valid ikut lolos guard global.
@Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI, UserRole.TIM_PENJAHIT)
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  /**
   * GET /production/routings/:productType
   * Ambil routing untuk satu product type.
   */
  @Get('routings/:productType')
  async getRouting(@Param('productType') productType: string) {
    return this.productionService.getRoutingByProductType(productType);
  }

  /**
   * GET /production/tasks
   * Daftar task dengan filter opsional.
   * - Owner & Manajer: lihat semua task
   * - Tim Penjahit: hanya lihat task miliknya sendiri
   */
  @Get('tasks')
  async getTasks(@Query() query: GetTasksQueryDto, @GetUser() actor: JwtPayload) {
    // Tim Penjahit hanya bisa lihat task miliknya sendiri
    if (actor.role === 'TIM_PENJAHIT') {
      return this.productionService.getTasks({
        ...query,
        assignedTo: actor.sub,
      });
    }
    return this.productionService.getTasks(query);
  }

  /**
   * PATCH /production/tasks/:id/status
   * Update status task.
   * - Owner & Manajer: bisa update task apapun
   * - Tim Penjahit: hanya task yang assignedTo dirinya sendiri
   */
  @Patch('tasks/:id/status')
  async updateTaskStatus(
    @Param('id', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskStatusDto,
    @GetUser() actor: JwtPayload,
  ) {
    return this.productionService.updateTaskStatus(taskId, dto, actor);
  }

  /**
   * POST /production/tasks/:id/assign
   * Assign task ke Tim Penjahit.
   * Hanya Owner & Manajer Produksi.
   */
  @Post('tasks/:id/assign')
  async assignTask(
    @Param('id', ParseUUIDPipe) taskId: string,
    @Body() dto: AssignTaskDto,
    @GetUser() actor: JwtPayload,
  ) {
    return this.productionService.assignTask(taskId, dto, actor);
  }
}
