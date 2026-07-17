import Link from 'next/link';
import { Shirt, Package, GraduationCap, ShoppingBag, Layers } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const PRODUCTS = [
  { icon: Shirt, nama: 'Kaos', deskripsi: 'Sablon & bordir custom, semua ukuran' },
  { icon: Layers, nama: 'Kemeja', deskripsi: 'Kemeja kerja & komunitas, bahan premium' },
  { icon: Package, nama: 'Hoodie', deskripsi: 'Hoodie custom dengan tali & finishing rapi' },
  { icon: GraduationCap, nama: 'Topi', deskripsi: 'Topi bordir untuk event & merchandise' },
  { icon: ShoppingBag, nama: 'Tas', deskripsi: 'Tote bag & tas custom untuk brand kamu' },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="border-b bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-20 text-center">
          <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
            Konveksi Online, dari Desain sampai Diantar
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Pesan kaos, kemeja, hoodie, topi, dan tas custom dengan mudah. Pantau produksi pesananmu
            secara real-time — tanpa perlu bolak-balik ke konveksi.
          </p>
          <Link href="/pesan" className={buttonVariants({ size: 'lg' })}>
            Pesan Sekarang
          </Link>
        </div>
      </section>

      {/* Produk */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="mb-8 text-center text-2xl font-semibold">Produk Kami</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {PRODUCTS.map((p) => (
            <Card key={p.nama}>
              <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                <p.icon className="h-10 w-10 text-muted-foreground" />
                <div className="font-semibold">{p.nama}</div>
                <p className="text-sm text-muted-foreground">{p.deskripsi}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA bawah */}
      <section className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-12 text-center">
          <h2 className="text-xl font-semibold">Siap mulai produksi?</h2>
          <p className="text-muted-foreground">
            Masuk dengan nomor HP atau akun Google — tanpa perlu bikin password.
          </p>
          <Link href="/login" className={buttonVariants({ variant: 'outline' })}>
            Masuk / Daftar
          </Link>
        </div>
      </section>
    </>
  );
}
