// ==========================================
// Seed Script — Fase 1 Dev Data
// Buat user staff awal + contoh customer
// Run: npx ts-node prisma/seed.ts
// ==========================================

import { PrismaClient, UserRole, CustomerAuthType } from '@prisma/client';
import { hashPassword } from '@mlv/auth';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // --- Staff Users ---
  const ownerPassword = await hashPassword('owner123');
  const manajerPassword = await hashPassword('manajer123');
  const penjahitPassword = await hashPassword('penjahit123');

  const owner = await prisma.user.upsert({
    where: { email: 'owner@mlv.dev' },
    update: {},
    create: {
      email: 'owner@mlv.dev',
      password: ownerPassword,
      nama: 'Owner MLV',
      role: UserRole.OWNER,
    },
  });
  console.log(`  ✅ Owner: ${owner.email}`);

  const manajer = await prisma.user.upsert({
    where: { email: 'manajer@mlv.dev' },
    update: {},
    create: {
      email: 'manajer@mlv.dev',
      password: manajerPassword,
      nama: 'Manajer Produksi',
      role: UserRole.MANAJER_PRODUKSI,
    },
  });
  console.log(`  ✅ Manajer: ${manajer.email}`);

  const penjahit = await prisma.user.upsert({
    where: { email: 'penjahit@mlv.dev' },
    update: {},
    create: {
      email: 'penjahit@mlv.dev',
      password: penjahitPassword,
      nama: 'Tim Penjahit #1',
      role: UserRole.TIM_PENJAHIT,
    },
  });
  console.log(`  ✅ Penjahit: ${penjahit.email}`);

  // --- Sample Customers ---
  const customer1 = await prisma.customer.upsert({
    where: { noHp: '08123456789' },
    update: {},
    create: {
      nama: 'Budi Pelanggan',
      noHp: '08123456789',
      email: 'budi@example.com',
      alamat: 'Jl. Contoh No. 1, Jakarta',
      authMethods: {
        create: {
          tipe: CustomerAuthType.OTP_HP,
          identifier: '08123456789',
        },
      },
    },
  });
  console.log(`  ✅ Customer: ${customer1.nama} (${customer1.noHp})`);

  const customer2 = await prisma.customer.upsert({
    where: { email: 'siti@example.com' },
    update: {},
    create: {
      nama: 'Siti Google User',
      email: 'siti@example.com',
      googleId: 'google_siti_sub_12345',
      authMethods: {
        create: {
          tipe: CustomerAuthType.GOOGLE,
          identifier: 'google_siti_sub_12345',
        },
      },
    },
  });
  console.log(`  ✅ Customer: ${customer2.nama} (${customer2.email})`);

  console.log('🎉 Seed selesai!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
