// ==========================================
// API client — semua request ke services/api (port 3000).
// credentials: 'include' agar cookie httpOnly ikut terkirim.
// 401 → coba refresh sekali → ulangi request → gagal lagi = ke /login.
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

async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
  });
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response = await rawFetch(path, init);

  if (response.status === 401) {
    // Access token kadaluarsa di tengah sesi — coba refresh sekali
    const refreshed = await rawFetch('/auth/refresh', { method: 'POST' });
    if (refreshed.ok) {
      response = await rawFetch(path, init);
    } else {
      window.location.href = '/login';
      throw new ApiError(401, 'Sesi berakhir, silakan login ulang');
    }
  }

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
