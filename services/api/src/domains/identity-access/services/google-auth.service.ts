import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

/** Identitas Google hasil verifikasi id_token (subset payload OIDC). */
export interface GoogleIdentity {
  /** Google user ID (`sub`) — identifier stabil, BUKAN email. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  nama: string | null;
}

/**
 * GoogleAuthService — verifikasi id_token Google Identity Services (Fase 10).
 *
 * Menggantikan mock Fase 1 SEPENUHNYA. Token dari client TIDAK pernah
 * dipercaya mentah-mentah: signature diverifikasi ke public key Google
 * (via google-auth-library, library resmi) + audience harus sama dengan
 * GOOGLE_CLIENT_ID kita (token untuk aplikasi lain ditolak).
 *
 * Fail-closed: GOOGLE_CLIENT_ID kosong/placeholder → 503, BUKAN fallback
 * mock diam-diam.
 *
 * Terisolasi di class sendiri supaya:
 * - AuthService unit test bisa mock verifikasi tanpa network.
 * - Logic Google terkurung satu tempat (pola FonnteChannel Fase 8).
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly clientId: string | undefined;
  private readonly client: OAuth2Client;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('GOOGLE_CLIENT_ID');
    this.client = new OAuth2Client(this.clientId);
  }

  async verifyIdToken(idToken: string): Promise<GoogleIdentity> {
    // Fail-closed: tanpa client ID asli, login Google dimatikan — tidak
    // ada jalur mock tersembunyi.
    if (!this.clientId || this.clientId.startsWith('mock_')) {
      throw new ServiceUnavailableException(
        'Login Google belum dikonfigurasi di server (GOOGLE_CLIENT_ID kosong)',
      );
    }

    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
      const payload = ticket.getPayload();

      if (!payload?.sub) {
        throw new Error('Payload token tidak berisi sub');
      }

      return {
        sub: payload.sub,
        email: payload.email ?? null,
        emailVerified: payload.email_verified === true,
        nama: payload.name ?? null,
      };
    } catch (err) {
      // Signature salah / expired / audience beda / format rusak —
      // detail teknis cukup di log server, client cukup tahu token ditolak.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Verifikasi id_token Google gagal: ${msg}`);
      throw new UnauthorizedException('Token Google tidak valid');
    }
  }
}
