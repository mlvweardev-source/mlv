import { IsString, IsOptional, IsInt, Min, Max, MinLength } from 'class-validator';
import { IsUUID } from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nama?: string;

  @IsOptional()
  @IsString()
  alamat?: string;

  @IsOptional()
  @IsString()
  email?: string;
}

export class CreateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  komentar?: string;

  @IsUUID()
  orderId!: string;
}
