// ==========================================
// API client apps/web — semua request ke services/api (port 3000).
// credentials: 'include' agar cookie httpOnly `mlv_customer_token`
// ikut terkirim. Pelanggan TIDAK punya refresh token (JWT 7 hari) —
// 401 = sesi habis, arahkan ke /login.
// ==========================================

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
  });

  if (!response.ok) {
    let message = `Request gagal (${response.status})`;
    try {
      const body = await response.json();
      message = typeof body.message === 'string' ? body.message : JSON.stringify(body.message);
    } catch {
      // biarkan message default
    }
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

export function apiJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
