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
// Custom Decorators
// ==========================================

/**
 * Decorator: menandai endpoint membutuhkan role tertentu.
 * Contoh: @Roles(UserRole.OWNER, UserRole.MANAJER_PRODUKSI)
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Decorator: menandai endpoint bisa diakses pelanggan.
 * Bisa dikombinasi dengan @Roles() untuk endpoint hybrid.
 */
export const ALLOW_CUSTOMER_KEY = 'allowCustomer';
export const AllowCustomer = () => SetMetadata(ALLOW_CUSTOMER_KEY, true);

/**
 * Decorator: menandai endpoint publik (tidak butuh auth).
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Decorator: Ambil user payload dari request.
 * Contoh: @GetUser() user: JwtPayload
 */
export const GetUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): JwtPayload => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});

// ==========================================
// Auth Guard (JWT Verification + RBAC)
// ==========================================

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if endpoint is public
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

    // Attach payload to request for downstream use
    request.user = payload;

    // Check roles
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const allowCustomer = this.reflector.getAllAndOverride<boolean>(ALLOW_CUSTOMER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles specified and no customer flag — any authenticated user OK
    if (!requiredRoles && !allowCustomer) {
      return true;
    }

    // Customer trying to access
    if (payload.actorType === ActorType.CUSTOMER) {
      if (allowCustomer) return true;
      throw new UnauthorizedException('Endpoint ini tidak tersedia untuk pelanggan');
    }

    // Staff trying to access — check role
    if (payload.actorType === ActorType.USER) {
      // Staff can always access customer-allowed endpoints
      if (!requiredRoles) return true;

      if (requiredRoles.includes(payload.role as UserRole)) {
        return true;
      }
      throw new UnauthorizedException(`Role ${payload.role} tidak memiliki akses ke endpoint ini`);
    }

    throw new UnauthorizedException('Akses ditolak');
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

    // Fase 9: staff portal (apps/admin) via httpOnly cookie.
    // Fase 10: customer portal (apps/web) via cookie terpisah —
    // di dev semua app share host localhost, cookie tidak boleh bentrok.
    return request.cookies?.['mlv_access_token'] ?? request.cookies?.['mlv_customer_token'] ?? null;
  }
}
