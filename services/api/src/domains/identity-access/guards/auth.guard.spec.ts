import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AuthGuard, ROLES_KEY, ALLOW_CUSTOMER_KEY, IS_PUBLIC_KEY } from './auth.guard';
import { UserRole, ActorType } from '@mlv/auth';

jest.mock('@mlv/auth', () => {
  const actual = jest.requireActual('@mlv/auth');
  return {
    ...actual,
    verifyJwt: jest.fn(),
  };
});

import { verifyJwt } from '@mlv/auth';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let reflector: Reflector;
  let configService: ConfigService;

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const mockConfigService = {
    getOrThrow: jest.fn().mockReturnValue('test-secret'),
  };

  function createMockContext(headers: any = {}, cookies: any = {}): ExecutionContext {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
          cookies,
        }),
      }),
    } as any;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = mockReflector as any;
    configService = mockConfigService as any;
    guard = new AuthGuard(reflector, configService);
  });

  describe('Public endpoints', () => {
    it('should allow access to public endpoints without token', () => {
      mockReflector.getAllAndOverride.mockReturnValue(true);

      const context = createMockContext();
      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('Token extraction', () => {
    it('should extract token from Bearer header', () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);
      (verifyJwt as jest.Mock).mockReturnValue({
        sub: 'user-1',
        role: UserRole.OWNER,
        actorType: ActorType.USER,
      });

      const context = createMockContext({ authorization: 'Bearer my-token' });
      guard.canActivate(context);

      expect(verifyJwt).toHaveBeenCalledWith('my-token', 'test-secret');
    });

    it('should extract token from mlv_access_token cookie', () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);
      (verifyJwt as jest.Mock).mockReturnValue({
        sub: 'user-1',
        role: UserRole.OWNER,
        actorType: ActorType.USER,
      });

      const context = createMockContext({}, { mlv_access_token: 'cookie-token' });
      guard.canActivate(context);

      expect(verifyJwt).toHaveBeenCalledWith('cookie-token', 'test-secret');
    });

    it('should extract token from mlv_customer_token cookie', () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);
      (verifyJwt as jest.Mock).mockReturnValue({
        sub: 'cust-1',
        actorType: ActorType.CUSTOMER,
      });

      const context = createMockContext({}, { mlv_customer_token: 'customer-token' });
      guard.canActivate(context);

      expect(verifyJwt).toHaveBeenCalledWith('customer-token', 'test-secret');
    });

    it('should prefer Bearer header over cookie', () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);
      (verifyJwt as jest.Mock).mockReturnValue({
        sub: 'user-1',
        role: UserRole.OWNER,
        actorType: ActorType.USER,
      });

      const context = createMockContext(
        { authorization: 'Bearer header-token' },
        { mlv_access_token: 'cookie-token' },
      );
      guard.canActivate(context);

      expect(verifyJwt).toHaveBeenCalledWith('header-token', 'test-secret');
    });

    it('should throw UnauthorizedException when no token found', () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);

      const context = createMockContext({}, {});
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('should reject non-Bearer authorization scheme', () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);

      const context = createMockContext({ authorization: 'Basic abc123' }, {});
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });
  });

  describe('JWT verification', () => {
    it('should throw UnauthorizedException for invalid token', () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);
      (verifyJwt as jest.Mock).mockImplementation(() => {
        throw new Error('invalid token');
      });

      const context = createMockContext({ authorization: 'Bearer bad-token' });
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('should attach payload to request on success', () => {
      const payload = { sub: 'user-1', role: UserRole.OWNER, actorType: ActorType.USER };
      mockReflector.getAllAndOverride.mockReturnValue(undefined);
      (verifyJwt as jest.Mock).mockReturnValue(payload);

      const request: any = { headers: { authorization: 'Bearer valid-token' }, cookies: {} };
      const context = {
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: () => ({ getRequest: () => request }),
      } as any;

      guard.canActivate(context);

      expect(request.user).toEqual(payload);
    });
  });

  describe('RBAC - Role-based access', () => {
    it('should allow access when no roles specified and no customer flag', () => {
      mockReflector.getAllAndOverride.mockReturnValue(undefined);
      (verifyJwt as jest.Mock).mockReturnValue({
        sub: 'user-1',
        role: UserRole.TIM_PENJAHIT,
        actorType: ActorType.USER,
      });

      const context = createMockContext({ authorization: 'Bearer token' });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow staff with matching role', () => {
      // First call: isPublic = false/undefined, second call: roles, third call: allowCustomer
      mockReflector.getAllAndOverride
        .mockReturnValueOnce(undefined) // isPublic
        .mockReturnValueOnce([UserRole.OWNER, UserRole.MANAJER_PRODUKSI]) // requiredRoles
        .mockReturnValueOnce(undefined); // allowCustomer
      (verifyJwt as jest.Mock).mockReturnValue({
        sub: 'user-1',
        role: UserRole.OWNER,
        actorType: ActorType.USER,
      });

      const context = createMockContext({ authorization: 'Bearer token' });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should deny staff with non-matching role', () => {
      mockReflector.getAllAndOverride
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce([UserRole.OWNER])
        .mockReturnValueOnce(undefined);
      (verifyJwt as jest.Mock).mockReturnValue({
        sub: 'user-1',
        role: UserRole.TIM_PENJAHIT,
        actorType: ActorType.USER,
      });

      const context = createMockContext({ authorization: 'Bearer token' });
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });
  });

  describe('RBAC - Customer access', () => {
    it('should allow customer on @AllowCustomer endpoint', () => {
      mockReflector.getAllAndOverride
        .mockReturnValueOnce(undefined) // isPublic
        .mockReturnValueOnce(undefined) // requiredRoles
        .mockReturnValueOnce(true); // allowCustomer
      (verifyJwt as jest.Mock).mockReturnValue({
        sub: 'cust-1',
        actorType: ActorType.CUSTOMER,
      });

      const context = createMockContext({ authorization: 'Bearer token' });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should deny customer on non-customer endpoint', () => {
      mockReflector.getAllAndOverride
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce([UserRole.OWNER])
        .mockReturnValueOnce(undefined);
      (verifyJwt as jest.Mock).mockReturnValue({
        sub: 'cust-1',
        actorType: ActorType.CUSTOMER,
      });

      const context = createMockContext({ authorization: 'Bearer token' });
      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('should allow staff on @AllowCustomer endpoint', () => {
      mockReflector.getAllAndOverride
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined) // no requiredRoles
        .mockReturnValueOnce(true); // allowCustomer
      (verifyJwt as jest.Mock).mockReturnValue({
        sub: 'user-1',
        role: UserRole.OWNER,
        actorType: ActorType.USER,
      });

      const context = createMockContext({ authorization: 'Bearer token' });
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('RBAC - Hybrid endpoints (roles + allowCustomer)', () => {
    it('should allow customer when allowCustomer is true even with roles defined', () => {
      mockReflector.getAllAndOverride
        .mockReturnValueOnce(undefined) // isPublic
        .mockReturnValueOnce([UserRole.OWNER]) // requiredRoles
        .mockReturnValueOnce(true); // allowCustomer
      (verifyJwt as jest.Mock).mockReturnValue({
        sub: 'cust-1',
        actorType: ActorType.CUSTOMER,
      });

      const context = createMockContext({ authorization: 'Bearer token' });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('should allow staff with matching role on hybrid endpoint', () => {
      mockReflector.getAllAndOverride
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce([UserRole.OWNER])
        .mockReturnValueOnce(true);
      (verifyJwt as jest.Mock).mockReturnValue({
        sub: 'user-1',
        role: UserRole.OWNER,
        actorType: ActorType.USER,
      });

      const context = createMockContext({ authorization: 'Bearer token' });
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Staff can access customer-allowed endpoints', () => {
    it('should allow staff when only allowCustomer is set (no roles)', () => {
      mockReflector.getAllAndOverride
        .mockReturnValueOnce(undefined) // isPublic
        .mockReturnValueOnce(undefined) // no requiredRoles
        .mockReturnValueOnce(true); // allowCustomer
      (verifyJwt as jest.Mock).mockReturnValue({
        sub: 'user-1',
        role: UserRole.TIM_PENJAHIT,
        actorType: ActorType.USER,
      });

      const context = createMockContext({ authorization: 'Bearer token' });
      expect(guard.canActivate(context)).toBe(true);
    });
  });
});
