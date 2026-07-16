import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_TOKEN_COOKIE } from '@/lib/auth';

// Server-side URL notification service (proses terpisah, port 3001).
// Pola sama dengan API_INTERNAL_URL di proxy.ts.
const NOTIFICATION_URL = process.env.NOTIFICATION_INTERNAL_URL ?? 'http://localhost:3001';

/**
 * GET /api/notifications — proxy same-origin ke services/notification.
 *
 * Kenapa proxy (Fase 9.4 fix): cookie auth `mlv_access_token` adalah
 * host-only cookie (tanpa atribut Domain) milik host services/api.
 * Fetch browser langsung ke notification service hanya "kebetulan jalan"
 * di localhost karena cookie mengabaikan port — di production dengan
 * host terpisah, cookie TIDAK akan terkirim. Dengan proxy ini browser
 * hanya pernah bicara ke satu origin (apps/admin); server yang
 * meneruskan token ke notification service sebagai Bearer.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const upstream = await fetch(`${NOTIFICATION_URL}/notifications${request.nextUrl.search}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json(
      { message: 'Notification service tidak dapat dihubungi' },
      { status: 502 },
    );
  }

  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  });
}
