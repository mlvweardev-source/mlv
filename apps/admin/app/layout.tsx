import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MLV Admin — Portal Internal',
  description: 'Portal internal MLV untuk Owner, Manajer Produksi, dan Tim Penjahit.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
