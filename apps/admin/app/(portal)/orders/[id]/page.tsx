import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_TOKEN_COOKIE, decodeJwtPayload, type StaffRole } from '@/lib/auth';
import { OrderDetailClient } from './order-detail-client';

/**
 * Server component: baca role dari cookie httpOnly (JS client tidak bisa),
 * teruskan ke client component untuk menentukan aksi yang tampil (§5.1).
 */
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const payload = accessToken ? decodeJwtPayload(accessToken) : null;

  if (!payload?.role) {
    redirect('/login');
  }

  return <OrderDetailClient orderId={id} role={payload.role as StaffRole} />;
}
