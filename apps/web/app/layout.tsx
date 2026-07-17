import type { Metadata } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export const metadata: Metadata = {
  title: 'MLV — Konveksi Online: Kaos, Kemeja, Hoodie, Topi, Tas',
  description:
    'Platform pemesanan konveksi online terintegrasi AI. Pesan kaos, kemeja, hoodie, topi, tas, dan lainnya dengan mudah.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
