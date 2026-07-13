// ==========================================
// @mlv/auth — Password Hashing Utilities
// ==========================================

import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

/**
 * Hash a plain text password.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare plain text password against a hash.
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Hash an OTP code (lower rounds for speed since OTP is short-lived).
 */
export async function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, 6);
}

/**
 * Compare OTP code against hash.
 */
export async function compareOtp(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
