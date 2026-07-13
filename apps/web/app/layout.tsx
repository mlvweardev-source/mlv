import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'MLV — Sistem Pemesanan Konveksi Online',
  description:
    'Platform pemesanan konveksi online terintegrasi AI. Pesan kaos, kemeja, hoodie, topi, tas, dan lainnya dengan mudah.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
