import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-6xl font-bold text-muted-foreground">403</h1>
      <p className="text-lg font-medium">Akses ditolak</p>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        Role Anda tidak memiliki hak akses ke halaman ini (§5.1 Matriks Hak Akses).
      </p>
      <Link href="/" className={buttonVariants({ variant: 'outline' })}>
        Kembali ke beranda
      </Link>
    </main>
  );
}
