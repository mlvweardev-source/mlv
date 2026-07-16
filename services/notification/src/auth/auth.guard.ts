import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { verifyJwt, UserRole, ActorType } from '@mlv/auth';
import type { JwtPayload } from '@mlv/auth';

// ==========================================
// Custom Decorators (pola sama dengan services/api)
// ==========================================

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const GetUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): JwtPayload => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});

// ==========================================
// Auth Guard (JWT Verification + RBAC)
// ==========================================
// services/notification adalah PROSES TERPISAH dari services/api —
// guard sendiri, tapi verifikasi JWT pakai @mlv/auth yang sama
// (JWT_SECRET shared via env) sehingga token staff berlaku lintas proses.
//
// §5.1 Notification Center: staff only (Owner/Manajer full, Penjahit
// milik sendiri) — pelanggan DITOLAK di guard (customer notif = Fase 10).

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Token tidak ditemukan');
    }

    const secret = this.config.getOrThrow<string>('JWT_SECRET');
    let payload: JwtPayload;

    try {
      payload = verifyJwt(token, secret);
    } catch {
      throw new UnauthorizedException('Token tidak valid atau sudah kadaluarsa');
    }

    // §5.1: Notification Center khusus staff internal
    if (payload.actorType !== ActorType.USER) {
      throw new UnauthorizedException(
        'Notification Center hanya tersedia untuk staff internal (Customer Portal menyusul di fase berikutnya)',
      );
    }

    request.user = payload;

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) return true;

    if (requiredRoles.includes(payload.role as UserRole)) {
      return true;
    }

    throw new UnauthorizedException(`Role ${payload.role} tidak memiliki akses ke endpoint ini`);
  }

  private extractToken(request: {
    headers: { authorization?: string };
    cookies?: Record<string, string>;
  }): string | null {
    const authorization = request.headers.authorization;
    if (authorization) {
      const [type, token] = authorization.split(' ');
      if (type === 'Bearer' && token) return token;
    }
    // Fase 9.4: support cookie untuk portal admin
    return request.cookies?.['mlv_access_token'] ?? null;
  }
}
