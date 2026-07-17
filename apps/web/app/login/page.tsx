'use client';

import Script from 'next/script';
import { Suspense, useCallback, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiJson, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

// Tipe minimal Google Identity Services (script eksternal accounts.google.com)
interface GoogleCredentialResponse {
  credential: string;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

type Step = 'phone' | 'code';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  const goHome = useCallback(() => {
    const from = searchParams.get('from');
    router.push(from ?? '/');
    router.refresh();
  }, [router, searchParams]);

  // ---- Alur OTP ----

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Kode dikirim ke WA via Fonnte (queue notification-events)
      await apiJson('/auth/otp/request', 'POST', { phone });
      setInfo(`Kode OTP dikirim ke WhatsApp ${phone}. Berlaku 5 menit.`);
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Tidak bisa terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Sukses: cookie httpOnly `mlv_customer_token` di-set oleh API —
      // token tidak pernah menyentuh JS (pola sama dengan portal admin).
      await apiJson('/auth/otp/verify', 'POST', { phone, code });
      goHome();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Tidak bisa terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }

  // ---- Alur Google ----

  const handleGoogleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      setError(null);
      try {
        // id_token diverifikasi server-side ke Google (signature + audience)
        await apiJson('/auth/google/callback', 'POST', { idToken: response.credential });
        goHome();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Login Google gagal.');
      }
    },
    [goHome],
  );

  const initGoogle = useCallback(() => {
    if (!GOOGLE_CLIENT_ID || !window.google || !googleButtonRef.current) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
    });
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: 'outline',
      size: 'large',
      width: 320,
      text: 'signin_with',
      locale: 'id',
    });
  }, [handleGoogleCredential]);

  return (
    <Card className="w-full max-w-sm">
      {GOOGLE_CLIENT_ID && (
        <Script src="https://accounts.google.com/gsi/client" onReady={initGoogle} />
      )}
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Masuk ke MLV</CardTitle>
        <CardDescription>
          Pakai nomor HP (kode OTP via WhatsApp) atau akun Google — akun dibuat otomatis saat
          pertama masuk.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 'phone' ? (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="phone" className="text-sm font-medium">
                Nomor HP (WhatsApp)
              </label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                placeholder="08123456789"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoComplete="tel"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Mengirim…' : 'Kirim Kode OTP'}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            {info && (
              <p className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                {info}
              </p>
            )}
            <div className="space-y-1.5">
              <label htmlFor="code" className="text-sm font-medium">
                Kode OTP
              </label>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="6 digit"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoComplete="one-time-code"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Memeriksa…' : 'Verifikasi & Masuk'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setStep('phone');
                setCode('');
                setInfo(null);
                setError(null);
              }}
            >
              Ganti nomor / kirim ulang
            </Button>
          </form>
        )}

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">atau</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {GOOGLE_CLIENT_ID ? (
          <div ref={googleButtonRef} className="flex justify-center" />
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            Login Google belum dikonfigurasi (NEXT_PUBLIC_GOOGLE_CLIENT_ID kosong).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-muted/40 p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
