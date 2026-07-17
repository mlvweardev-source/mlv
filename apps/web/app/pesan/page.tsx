import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Placeholder alur pemesanan — dibangun di Fase 10 Bagian 2 (Checkout).
 * Halaman ini publik: pelanggan boleh melihat-lihat dulu, login diminta
 * saat checkout.
 */
export default function PesanPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-6xl items-center justify-center px-4">
      <Card className="max-w-md text-center">
        <CardHeader>
          <CardTitle>Pesan Sekarang</CardTitle>
          <CardDescription>
            Alur pemesanan online sedang disiapkan (Bagian 2). Sementara ini, hubungi kami via
            WhatsApp untuk memesan.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Segera hadir: pilih produk, tentukan ukuran, upload desain, dan bayar DP langsung dari
          halaman ini.
        </CardContent>
      </Card>
    </div>
  );
}
