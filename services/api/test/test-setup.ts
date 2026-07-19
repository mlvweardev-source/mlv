import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { prisma } from '@mlv/db';
import { signJwt, UserRole, ActorType } from '@mlv/auth';
import * as dotenv from 'dotenv';
import { join } from 'path';

// Load env from monorepo root
dotenv.config({ path: join(__dirname, '../../../.env') });

const TEST_JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-integration';

/**
 * Bootstrap a NestJS application for integration testing.
 * Uses the REAL database (PostgreSQL) — not mocked.
 * EventBusService is mocked to avoid needing Redis.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider('BullModule_0_1_2_3_4')
    .useValue({})
    .compile();

  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

/**
 * Generate a valid JWT token for a staff user.
 */
export function staffToken(userId: string, role: UserRole, email?: string): string {
  return signJwt({ sub: userId, actorType: ActorType.USER, role, email }, TEST_JWT_SECRET, '1h');
}

/**
 * Generate a valid JWT token for a customer.
 */
export function customerToken(customerId: string): string {
  return signJwt({ sub: customerId, actorType: ActorType.CUSTOMER }, TEST_JWT_SECRET, '1h');
}

/**
 * Clean all test data from the database.
 * Order matters due to foreign key constraints.
 * Preserves seed data (staff users, customers, materials, BOMs, routings, warehouse).
 */
export async function cleanTestData(): Promise<void> {
  // Delete in dependency order (children first)
  await prisma.$transaction([
    prisma.activityLog.deleteMany(),
    prisma.customerChatMessage.deleteMany(),
    prisma.customerChatThread.deleteMany(),
    prisma.internalChatMessage.deleteMany(),
    prisma.internalChatThread.deleteMany(),
    prisma.notificationLog.deleteMany(),
    prisma.orderTimelineEvent.deleteMany(),
    prisma.orderMaterial.deleteMany(),
    prisma.orderService.deleteMany(),
    prisma.orderDesign.deleteMany(),
    prisma.orderSize.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.order.deleteMany(),
    prisma.productionTask.deleteMany(),
    prisma.approval.deleteMany(),
    prisma.profitSharing.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.shipment.deleteMany(),
    prisma.review.deleteMany(),
    prisma.stockMovement.deleteMany(),
    prisma.stockReservation.deleteMany(),
    prisma.stockAdjustment.deleteMany(),
    prisma.purchaseOrder.deleteMany(),
    prisma.stockBalance.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.otpCode.deleteMany(),
  ]);
}

/**
 * Seed essential test data that integration tests depend on.
 * Creates staff users, customer, warehouse, materials, BOMs, routings, stock.
 */
export async function seedTestData() {
  const { hashPassword } = await import('@mlv/auth');

  // Staff users
  const ownerPw = await hashPassword('owner123');
  const manajerPw = await hashPassword('manajer123');
  const penjahitPw = await hashPassword('penjahit123');

  const owner = await prisma.user.upsert({
    where: { email: 'owner@mlv.dev' },
    update: { password: ownerPw },
    create: { email: 'owner@mlv.dev', password: ownerPw, nama: 'Owner MLV', role: 'OWNER' },
  });
  const manajer = await prisma.user.upsert({
    where: { email: 'manajer@mlv.dev' },
    update: { password: manajerPw },
    create: {
      email: 'manajer@mlv.dev',
      password: manajerPw,
      nama: 'Manajer Produksi',
      role: 'MANAJER_PRODUKSI',
    },
  });
  const penjahit = await prisma.user.upsert({
    where: { email: 'penjahit@mlv.dev' },
    update: { password: penjahitPw },
    create: {
      email: 'penjahit@mlv.dev',
      password: penjahitPw,
      nama: 'Tim Penjahit #1',
      role: 'TIM_PENJAHIT',
    },
  });

  // Customer
  const customer = await prisma.customer.upsert({
    where: { noHp: '08123456789' },
    update: {},
    create: {
      nama: 'Budi Pelanggan',
      noHp: '08123456789',
      email: 'budi@example.com',
      alamat: 'Jl. Contoh No. 1, Jakarta',
      authMethods: { create: { tipe: 'OTP_HP', identifier: '08123456789' } },
    },
  });

  // Warehouse — use findFirst to get the real seeded warehouse (don't hardcode ID)
  const warehouse = await prisma.warehouse.findFirst();
  if (!warehouse) throw new Error('No warehouse found — run db:seed first');

  // Materials — upsert known materials, then get ALL materials from DB
  const knownMaterials = [
    'Kain',
    'Label',
    'Plastik Kemasan',
    'Hangtag',
    'Benang',
    'Kancing',
    'Tali Hoodie',
    'Tali Tas',
  ];
  for (const nama of knownMaterials) {
    const existing = await prisma.material.findFirst({ where: { nama } });
    if (!existing) {
      await prisma.material.create({
        data: { nama, satuan: nama === 'Kain' ? 'meter' : 'pcs', kategori: 'bahan' },
      });
    }
  }
  // Get ALL materials (including ones from previous seeds)
  const allMaterials = await prisma.material.findMany();
  const materialRecords: Record<string, string> = {};
  for (const m of allMaterials) {
    materialRecords[m.nama] = m.id;
  }

  // BOM — ensure at least the Kaos BOM entries exist (merge with existing BOMs)
  const bomEntries = [
    { material: 'Kain', qty: 2.3 },
    { material: 'Label', qty: 1 },
    { material: 'Plastik Kemasan', qty: 1 },
    { material: 'Hangtag', qty: 1 },
    { material: 'Benang', qty: 0.1 },
  ];
  for (const b of bomEntries) {
    const matId = materialRecords[b.material];
    if (matId) {
      await prisma.billOfMaterial.upsert({
        where: { productType_materialId: { productType: 'Kaos', materialId: matId } },
        update: { qtyPerUnit: b.qty },
        create: { productType: 'Kaos', materialId: matId, qtyPerUnit: b.qty },
      });
    }
  }

  // Stock balances — create for ALL materials in DB with generous stock
  const defaultStock = 10000;
  for (const m of allMaterials) {
    await prisma.stockBalance.upsert({
      where: { materialId_warehouseId: { materialId: m.id, warehouseId: warehouse.id } },
      update: { qtyAvailable: defaultStock, qtyReserved: 0 },
      create: {
        materialId: m.id,
        warehouseId: warehouse.id,
        qtyAvailable: defaultStock,
        qtyReserved: 0,
      },
    });
  }

  // Production routing for Kaos
  await prisma.productionRouting.upsert({
    where: { productType: 'Kaos' },
    update: {},
    create: {
      productType: 'Kaos',
      urutanTask: ['CUTTING', 'PRINTING', 'SEWING', 'FINISHING', 'IRONING', 'PACKING'],
      estimasiBiayaJahitPerPcs: 5000,
    },
  });

  // Product price list
  await prisma.productPriceList.upsert({
    where: { productType: 'Kaos' },
    update: { hargaDasarPerPcs: 85000 },
    create: { productType: 'Kaos', hargaDasarPerPcs: 85000 },
  });

  return { owner, manajer, penjahit, customer, warehouse, materialRecords };
}
