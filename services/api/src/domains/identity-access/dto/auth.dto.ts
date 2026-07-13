import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;
}

export class OtpRequestDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;
}

export class OtpVerifyDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class GoogleCallbackDto {
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}
