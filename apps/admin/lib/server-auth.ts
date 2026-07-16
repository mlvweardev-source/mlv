import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, decodeJwtPayload, type StaffRole } from './auth';

/**
 * Server component helper: baca role dari cookie httpOnly.
 * proxy.ts sudah menjamin token valid — decode di sini hanya untuk
 * menentukan view/aksi yang dirender (§5.1); enforcement data tetap di API.
 */
export async function requireRole(): Promise<StaffRole> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const payload = accessToken ? decodeJwtPayload(accessToken) : null;

  if (!payload?.role) {
    redirect('/login');
  }

  return payload.role as StaffRole;
}
