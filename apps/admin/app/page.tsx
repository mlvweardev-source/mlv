// Halaman root tidak pernah dirender — proxy.ts me-redirect '/'
// ke /dashboard atau /orders sesuai role, atau ke /login jika belum login.
export default function Home() {
  return null;
}
