import { IsOptional, IsString, Matches } from 'class-validator';

export class DashboardQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from harus format YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to harus format YYYY-MM-DD' })
  to?: string;
}
