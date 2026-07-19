import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { GoogleAuthService } from './google-auth.service';

// Mock google-auth-library
const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

describe('GoogleAuthService', () => {
  let service: GoogleAuthService;
  let configService: ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function createService(clientId?: string) {
    const mockConfig = {
      get: jest.fn().mockReturnValue(clientId),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [GoogleAuthService, { provide: ConfigService, useValue: mockConfig }],
    }).compile();
    return module.get<GoogleAuthService>(GoogleAuthService);
  }

  describe('verifyIdToken', () => {
    it('should throw ServiceUnavailableException when GOOGLE_CLIENT_ID is not set', async () => {
      service = await createService(undefined);

      await expect(service.verifyIdToken('some-token')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should throw ServiceUnavailableException when GOOGLE_CLIENT_ID starts with mock_', async () => {
      service = await createService('mock_google_client_id');

      await expect(service.verifyIdToken('some-token')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should throw UnauthorizedException when token verification fails', async () => {
      service = await createService('real-client-id');
      mockVerifyIdToken.mockRejectedValue(new Error('Token expired'));

      await expect(service.verifyIdToken('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when payload has no sub', async () => {
      service = await createService('real-client-id');
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({ email: 'test@gmail.com' }),
      });

      await expect(service.verifyIdToken('token-no-sub')).rejects.toThrow(UnauthorizedException);
    });

    it('should return GoogleIdentity on successful verification', async () => {
      service = await createService('real-client-id');
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google-123',
          email: 'user@gmail.com',
          email_verified: true,
          name: 'Test User',
        }),
      });

      const result = await service.verifyIdToken('valid-token');

      expect(result).toEqual({
        sub: 'google-123',
        email: 'user@gmail.com',
        emailVerified: true,
        nama: 'Test User',
      });
    });

    it('should handle null email and name in payload', async () => {
      service = await createService('real-client-id');
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google-456',
          email: undefined,
          email_verified: undefined,
          name: undefined,
        }),
      });

      const result = await service.verifyIdToken('valid-token');

      expect(result.sub).toBe('google-456');
      expect(result.email).toBeNull();
      expect(result.emailVerified).toBe(false);
      expect(result.nama).toBeNull();
    });

    it('should verify token with correct audience', async () => {
      service = await createService('my-client-id');
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: 'google-789',
          email: 'test@gmail.com',
          email_verified: true,
          name: 'Test',
        }),
      });

      await service.verifyIdToken('some-token');

      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: 'some-token',
        audience: 'my-client-id',
      });
    });

    it('should throw UnauthorizedException for non-Error thrown values', async () => {
      service = await createService('real-client-id');
      mockVerifyIdToken.mockRejectedValue('string error');

      await expect(service.verifyIdToken('bad-token')).rejects.toThrow(UnauthorizedException);
    });
  });
});
