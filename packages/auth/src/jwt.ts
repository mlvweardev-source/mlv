// ==========================================
// @mlv/auth — JWT Utilities
// ==========================================

import jwt, { type SignOptions } from 'jsonwebtoken';
import { JwtPayload } from './roles';

/**
 * Sign a JWT token with the given payload.
 */
export function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  expiresIn: string = '7d',
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: SignOptions = { expiresIn: expiresIn as any };
  return jwt.sign(payload as object, secret, options);
}

/**
 * Verify and decode a JWT token.
 * Throws if the token is invalid or expired.
 */
export function verifyJwt(token: string, secret: string): JwtPayload {
  return jwt.verify(token, secret) as JwtPayload;
}
