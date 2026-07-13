// ==========================================
// @mlv/auth — Roles & Constants
// ==========================================

/**
 * Role untuk user internal (staff).
 * Harus match dengan enum UserRole di Prisma schema.
 */
export enum UserRole {
  OWNER = 'OWNER',
  MANAJER_PRODUKSI = 'MANAJER_PRODUKSI',
  TIM_PENJAHIT = 'TIM_PENJAHIT',
}

/**
 * Tipe aktor — membedakan antara staff internal dan pelanggan.
 */
export enum ActorType {
  USER = 'USER', // staff internal
  CUSTOMER = 'CUSTOMER', // pelanggan
}

/**
 * Payload yang disimpan di dalam JWT token.
 */
export interface JwtPayload {
  sub: string; // user/customer ID
  actorType: ActorType;
  role?: UserRole; // hanya untuk staff internal
  email?: string;
  iat?: number;
  exp?: number;
}
