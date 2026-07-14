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

  // ==========================================
  // Inventory Domain Seeding (§6.4, §25.2)
  // ==========================================

  // --- Warehouse ---
  console.log('🌱 Seeding warehouses...');
  let warehouse = await prisma.warehouse.findFirst({
    where: { nama: 'Gudang Utama' },
  });
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({
      data: {
        nama: 'Gudang Utama',
        lokasi: 'Bandung',
      },
    });
  }
  console.log(`  ✅ Warehouse: ${warehouse.nama} (${warehouse.lokasi})`);

  // --- Materials ---
  console.log('🌱 Seeding materials...');
  const materialsData = [
    // Shared materials
    { nama: 'Kain', satuan: 'meter', kategori: 'kain' },
    { nama: 'Label', satuan: 'pcs', kategori: 'aksesoris' },
    { nama: 'Plastik Kemasan', satuan: 'pcs', kategori: 'aksesoris' },
    { nama: 'Hangtag', satuan: 'pcs', kategori: 'aksesoris' },
    { nama: 'Benang', satuan: 'cone', kategori: 'aksesoris' },
    // Kemeja specific
    { nama: 'Kancing', satuan: 'pcs', kategori: 'kancing' },
    // Hoodie & Tas specific
    { nama: 'Tali Hoodie', satuan: 'pcs', kategori: 'aksesoris' },
    { nama: 'Tali Tas', satuan: 'pcs', kategori: 'aksesoris' },
  ];

  const materials: Record<string, any> = {};
  for (const m of materialsData) {
    let material = await prisma.material.findFirst({
      where: { nama: m.nama },
    });
    if (!material) {
      material = await prisma.material.create({
        data: m,
      });
    }
    materials[m.nama] = material;
    console.log(`  ✅ Material: ${material.nama} (${material.satuan})`);
  }

  // --- BOM for Kaos (§25.2) ---
  console.log('🌱 Seeding BOM for Kaos...');
  const bomKaos = [
    { materialName: 'Kain', qtyPerUnit: 2.3 },
    { materialName: 'Label', qtyPerUnit: 1.0 },
    { materialName: 'Plastik Kemasan', qtyPerUnit: 1.0 },
    { materialName: 'Hangtag', qtyPerUnit: 1.0 },
    { materialName: 'Benang', qtyPerUnit: 0.3 },
  ];

  for (const b of bomKaos) {
    const material = materials[b.materialName];
    if (material) {
      await prisma.billOfMaterial.upsert({
        where: {
          productType_materialId: {
            productType: 'Kaos',
            materialId: material.id,
          },
        },
        update: {
          qtyPerUnit: b.qtyPerUnit,
        },
        create: {
          productType: 'Kaos',
          materialId: material.id,
          qtyPerUnit: b.qtyPerUnit,
        },
      });
      console.log(`  ✅ BOM Kaos: ${b.materialName} -> ${b.qtyPerUnit} ${material.satuan}`);
    }
  }

  // --- BOM for Kemeja ---
  console.log('🌱 Seeding BOM for Kemeja (placeholder - review dengan data produksi asli)...');
  const bomKemeja = [
    { materialName: 'Kain', qtyPerUnit: 2.6 },
    { materialName: 'Kancing', qtyPerUnit: 7.0 },
    { materialName: 'Label', qtyPerUnit: 1.0 },
    { materialName: 'Plastik Kemasan', qtyPerUnit: 1.0 },
    { materialName: 'Hangtag', qtyPerUnit: 1.0 },
    { materialName: 'Benang', qtyPerUnit: 0.35 },
  ];

  for (const b of bomKemeja) {
    const material = materials[b.materialName];
    if (material) {
      await prisma.billOfMaterial.upsert({
        where: {
          productType_materialId: {
            productType: 'Kemeja',
            materialId: material.id,
          },
        },
        update: {
          qtyPerUnit: b.qtyPerUnit,
        },
        create: {
          productType: 'Kemeja',
          materialId: material.id,
          qtyPerUnit: b.qtyPerUnit,
        },
      });
      console.log(`  ✅ BOM Kemeja: ${b.materialName} -> ${b.qtyPerUnit} ${material.satuan}`);
    }
  }

  // --- BOM for Hoodie ---
  console.log('🌱 Seeding BOM for Hoodie (placeholder - review dengan data produksi asli)...');
  const bomHoodie = [
    { materialName: 'Kain', qtyPerUnit: 3.5 },
    { materialName: 'Tali Hoodie', qtyPerUnit: 1.0 },
    { materialName: 'Label', qtyPerUnit: 1.0 },
    { materialName: 'Plastik Kemasan', qtyPerUnit: 1.0 },
    { materialName: 'Hangtag', qtyPerUnit: 1.0 },
    { materialName: 'Benang', qtyPerUnit: 0.5 },
  ];

  for (const b of bomHoodie) {
    const material = materials[b.materialName];
    if (material) {
      await prisma.billOfMaterial.upsert({
        where: {
          productType_materialId: {
            productType: 'Hoodie',
            materialId: material.id,
          },
        },
        update: {
          qtyPerUnit: b.qtyPerUnit,
        },
        create: {
          productType: 'Hoodie',
          materialId: material.id,
          qtyPerUnit: b.qtyPerUnit,
        },
      });
      console.log(`  ✅ BOM Hoodie: ${b.materialName} -> ${b.qtyPerUnit} ${material.satuan}`);
    }
  }

  // --- BOM for Topi ---
  console.log('🌱 Seeding BOM for Topi (placeholder - review dengan data produksi asli)...');
  const bomTopi = [
    { materialName: 'Kain', qtyPerUnit: 0.3 },
    { materialName: 'Label', qtyPerUnit: 1.0 },
    { materialName: 'Hangtag', qtyPerUnit: 1.0 },
    { materialName: 'Benang', qtyPerUnit: 0.1 },
  ];

  for (const b of bomTopi) {
    const material = materials[b.materialName];
    if (material) {
      await prisma.billOfMaterial.upsert({
        where: {
          productType_materialId: {
            productType: 'Topi',
            materialId: material.id,
          },
        },
        update: {
          qtyPerUnit: b.qtyPerUnit,
        },
        create: {
          productType: 'Topi',
          materialId: material.id,
          qtyPerUnit: b.qtyPerUnit,
        },
      });
      console.log(`  ✅ BOM Topi: ${b.materialName} -> ${b.qtyPerUnit} ${material.satuan}`);
    }
  }

  // --- BOM for Tas ---
  console.log('🌱 Seeding BOM for Tas (placeholder - review dengan data produksi asli)...');
  const bomTas = [
    { materialName: 'Kain', qtyPerUnit: 0.8 },
    { materialName: 'Tali Tas', qtyPerUnit: 2.0 },
    { materialName: 'Label', qtyPerUnit: 1.0 },
    { materialName: 'Benang', qtyPerUnit: 0.2 },
  ];

  for (const b of bomTas) {
    const material = materials[b.materialName];
    if (material) {
      await prisma.billOfMaterial.upsert({
        where: {
          productType_materialId: {
            productType: 'Tas',
            materialId: material.id,
          },
        },
        update: {
          qtyPerUnit: b.qtyPerUnit,
        },
        create: {
          productType: 'Tas',
          materialId: material.id,
          qtyPerUnit: b.qtyPerUnit,
        },
      });
      console.log(`  ✅ BOM Tas: ${b.materialName} -> ${b.qtyPerUnit} ${material.satuan}`);
    }
  }

  // --- Initial Stock Balances & Movements ---
  console.log('🌱 Seeding initial stock balances (tercatat lewat stock_movements)...');
  const initialStock = [
    // Existing
    { name: 'Kain', qty: 1000 },
    { name: 'Label', qty: 5000 },
    { name: 'Plastik Kemasan', qty: 5000 },
    { name: 'Hangtag', qty: 5000 },
    { name: 'Benang', qty: 200 },
    // New materials
    { name: 'Kancing', qty: 3000 },
    { name: 'Tali Hoodie', qty: 500 },
    { name: 'Tali Tas', qty: 1000 },
  ];

  for (const item of initialStock) {
    const material = materials[item.name];
    if (material) {
      const balance = await prisma.stockBalance.findUnique({
        where: {
          materialId_warehouseId: {
            materialId: material.id,
            warehouseId: warehouse.id,
          },
        },
      });

      if (!balance) {
        // Record movement (IN)
        await prisma.stockMovement.create({
          data: {
            materialId: material.id,
            warehouseId: warehouse.id,
            tipe: 'IN',
            qty: item.qty,
            refType: 'initial_seed',
            refId: 'seed',
            createdBy: 'system',
          },
        });

        // Create balance
        await prisma.stockBalance.create({
          data: {
            materialId: material.id,
            warehouseId: warehouse.id,
            qtyAvailable: item.qty,
            qtyReserved: 0,
          },
        });
        console.log(`  ✅ Stock Balance: ${item.name} -> ${item.qty} ${material.satuan}`);
      } else {
        console.log(`  ℹ️ Stock Balance for ${item.name} already exists`);
      }
    }
  }

  // ==========================================
  // Production Domain Seeding (§6.3, §25.1)
  // ==========================================

  // NOTE: Urutan task dasar sesuai §25.1:
  // Cutting → Printing/Embroidery → Sewing → Finishing → Ironing → Packing
  // Task Printing & Embroidery di-skip jika order tidak punya service sablon/bordir.
  // Routing ini adalah asumsi awal yang bisa disesuaikan oleh Manajer Produksi nanti.

  console.log('🌱 Seeding production routings...');

  const routingsData = [
    // Kaos: Full flow (bisa sablon)
    {
      productType: 'Kaos',
      urutanTask: ['CUTTING', 'PRINTING', 'SEWING', 'FINISHING', 'IRONING', 'PACKING'],
    },
    // Kemeja: Tanpa printing/embroidery (asumsi untuk fase ini)
    {
      productType: 'Kemeja',
      urutanTask: ['CUTTING', 'SEWING', 'FINISHING', 'IRONING', 'PACKING'],
    },
    // Hoodie: Full flow dengan embroidery opsional
    {
      productType: 'Hoodie',
      urutanTask: ['CUTTING', 'EMBROIDERY', 'SEWING', 'FINISHING', 'IRONING', 'PACKING'],
    },
    // Topi: Simple flow
    {
      productType: 'Topi',
      urutanTask: ['CUTTING', 'SEWING', 'FINISHING', 'PACKING'],
    },
    // Tas: Simple flow
    {
      productType: 'Tas',
      urutanTask: ['CUTTING', 'SEWING', 'FINISHING', 'PACKING'],
    },
  ];

  for (const routing of routingsData) {
    await prisma.productionRouting.upsert({
      where: { productType: routing.productType },
      update: {
        urutanTask: routing.urutanTask,
      },
      create: {
        productType: routing.productType,
        urutanTask: routing.urutanTask,
      },
    });
    console.log(`  ✅ Routing ${routing.productType}: ${routing.urutanTask.join(' → ')}`);
  }

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
