import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OrderHistory } from './order-history';

/**
 * Placeholder riwayat pesanan — dibangun di Fase 10 Bagian 3 (portal
 * existing-customer). Route ini DILINDUNGI proxy.ts: tanpa sesi pelanggan
 * aktif, pengunjung di-redirect ke /login.
 */
export default function PesananPage() {
  return <OrderHistory />;
}

function PesananPlaceholderPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-6xl items-center justify-center px-4">
      <Card className="max-w-md text-center">
        <CardHeader>
          <CardTitle>Riwayat Pesanan</CardTitle>
          <CardDescription>
            Kamu sudah login — daftar pesanan, invoice, dan tracking produksi akan tampil di sini
            (Bagian 3).
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Segera hadir: status produksi real-time, unduh invoice, upload revisi desain, repeat
          order, dan review.
        </CardContent>
      </Card>
    </div>
  );
}
