// ==========================================
// Production Domain DTOs
// ==========================================

import { IsString, IsOptional, IsEnum, IsArray } from 'class-validator';
import { TaskStatus, TaskType } from '@mlv/db';

// GET /production/routings/:productType
export class GetRoutingDto {
  @IsString()
  productType!: string;
}

// GET /production/tasks
export class GetTasksQueryDto {
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  orderItemId?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}

// PATCH /production/tasks/:id/status
export class UpdateTaskStatusDto {
  @IsEnum(TaskStatus)
  status!: TaskStatus;
}

// POST /production/tasks/:id/assign
export class AssignTaskDto {
  @IsString()
  userId!: string; // User ID untuk ditugaskan
}

// PATCH /production/tasks/:id/qc — Fase 13: QC verification
export class SetQcStatusDto {
  @IsEnum(['pass', 'reject'])
  qcStatus!: 'pass' | 'reject';

  @IsOptional()
  @IsString()
  qcReason?: string;
}

// Response DTOs
export class ProductionTaskResponseDto {
  id!: string;
  orderItemId!: string;
  taskType!: TaskType;
  sequence!: number;
  status!: TaskStatus;
  assignedTo!: string | null;
  assignedToUser?: { id: string; nama: string; email: string } | null;
  startedAt!: Date | null;
  completedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
  orderItem?: {
    id: string;
    productType: string;
    orderId: string;
    order?: {
      id: string;
      orderNumber: string;
      customerId: string;
      status: string;
    };
  };
}

export class ProductionRoutingResponseDto {
  id!: string;
  productType!: string;
  urutanTask!: string[];
  createdAt!: Date;
  updatedAt!: Date;
}
