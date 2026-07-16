import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class FindActivityLogQueryDto {
  /** Filter tipe entitas, mis. 'Order' */
  @IsOptional()
  @IsString()
  entityType?: string;

  /** Filter ID entitas (dipakai bersama entityType) */
  @IsOptional()
  @IsString()
  entityId?: string;

  /** Jumlah maksimal baris (default 100, max 200) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
