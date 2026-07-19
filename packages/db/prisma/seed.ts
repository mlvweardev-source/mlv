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
      id: 'f2df1936-d819-46fd-8658-96b9dff7b7ce',
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

  // --- Product Price List (Fase 10 Bagian 2 - PLACEHOLDER DATA) ---
  console.log('🌱 Seeding product price list (placeholder data)...');
  const priceListData = [
    { productType: 'Kaos', hargaDasarPerPcs: 85000 },
    { productType: 'Kemeja', hargaDasarPerPcs: 120000 },
    { productType: 'Hoodie', hargaDasarPerPcs: 150000 },
    { productType: 'Topi', hargaDasarPerPcs: 45000 },
    { productType: 'Tas', hargaDasarPerPcs: 60000 },
  ];

  for (const p of priceListData) {
    await prisma.productPriceList.upsert({
      where: { productType: p.productType },
      update: { hargaDasarPerPcs: p.hargaDasarPerPcs },
      create: { productType: p.productType, hargaDasarPerPcs: p.hargaDasarPerPcs },
    });
    console.log(
      `  ✅ Price List (PLACEHOLDER): ${p.productType} -> Rp ${p.hargaDasarPerPcs.toLocaleString()}`,
    );
  }

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
    // Kaos: Standard garment flow
    {
      productType: 'Kaos',
      urutanTask: ['CUTTING', 'PRINTING', 'SEWING', 'FINISHING', 'IRONING', 'PACKING'],
      estimasiBiayaJahitPerPcs: 5000,
    },
    // Kemeja: Standard garment flow (no printing by default)
    {
      productType: 'Kemeja',
      urutanTask: ['CUTTING', 'SEWING', 'FINISHING', 'IRONING', 'PACKING'],
      estimasiBiayaJahitPerPcs: 8000,
    },
    // Hoodie: Standard garment flow
    {
      productType: 'Hoodie',
      urutanTask: ['CUTTING', 'PRINTING', 'SEWING', 'FINISHING', 'IRONING', 'PACKING'],
      estimasiBiayaJahitPerPcs: 10000,
    },
    // Topi: Simple flow
    {
      productType: 'Topi',
      urutanTask: ['CUTTING', 'SEWING', 'FINISHING', 'PACKING'],
      estimasiBiayaJahitPerPcs: 3000,
    },
    // Tas: Simple flow
    {
      productType: 'Tas',
      urutanTask: ['CUTTING', 'SEWING', 'FINISHING', 'PACKING'],
      estimasiBiayaJahitPerPcs: 7000,
    },
  ];

  for (const routing of routingsData) {
    await prisma.productionRouting.upsert({
      where: { productType: routing.productType },
      update: {
        urutanTask: routing.urutanTask,
        estimasiBiayaJahitPerPcs: routing.estimasiBiayaJahitPerPcs,
      },
      create: {
        productType: routing.productType,
        urutanTask: routing.urutanTask,
        estimasiBiayaJahitPerPcs: routing.estimasiBiayaJahitPerPcs,
      },
    });
    console.log(
      `  ✅ Routing ${routing.productType}: ${routing.urutanTask.join(' → ')} (biaya jahit: Rp ${routing.estimasiBiayaJahitPerPcs.toLocaleString('id-ID')}/pcs)`,
    );
  }

  // ==========================================
  // Notification Templates (§6.7, §7.1 — Fase 8)
  // Placeholder {{...}} dirender dari payload event (payload sudah
  // lengkap — domain penerbit yang melengkapinya, prinsip Fase 8).
  // ==========================================
  console.log('🌱 Seeding notification templates...');
  const notificationTemplates: {
    eventType: string;
    channel: 'WHATSAPP' | 'DASHBOARD';
    templateBody: string;
  }[] = [
    // ---- Channel WA (customer-facing, §7.1) ----
    {
      // Fase 10: kode OTP login pelanggan dikirim via WA (Fonnte) —
      // menggantikan console.log mock Fase 1. Kode plaintext hanya
      // hidup di pesan; notification_logs menyimpan versi masked.
      eventType: 'auth.otp.requested',
      channel: 'WHATSAPP',
      templateBody:
        'Kode OTP login MLV kamu: {{kode}}. Berlaku {{berlakuMenit}} menit. JANGAN bagikan kode ini ke siapa pun, termasuk pihak yang mengaku dari MLV.',
    },
    {
      eventType: 'payment.succeeded',
      channel: 'WHATSAPP',
      // Persis contoh §7.2
      templateBody:
        'Halo {{customerNama}}, pembayaran {{jenis}} sebesar Rp {{jumlah}} untuk order {{orderNumber}} sudah kami terima. Pembayaran diterima, pesanan masuk antrean. Terima kasih! — MLV',
    },
    {
      eventType: 'invoice.issued',
      channel: 'WHATSAPP',
      templateBody:
        'Halo {{customerNama}}, invoice {{jenis}} sebesar Rp {{jumlah}} untuk order {{orderNumber}} sudah diterbitkan. Mohon segera melakukan pembayaran. — MLV',
    },
    {
      eventType: 'shipment.created',
      channel: 'WHATSAPP',
      templateBody:
        'Halo {{customerNama}}, order {{orderNumber}} sudah dikirim via {{kurir}} (no. resi: {{noResi}}). Terima kasih sudah berbelanja di MLV!',
    },
    {
      eventType: 'production.completed',
      channel: 'WHATSAPP',
      templateBody:
        'Halo {{customerNama}}, produksi order {{orderNumber}} sudah selesai dan menunggu pelunasan. Setelah lunas, pesanan langsung kami kirim. — MLV',
    },
    // ---- Channel Dashboard (internal-facing, §7.1) ----
    {
      eventType: 'stock.low',
      channel: 'DASHBOARD',
      templateBody:
        'Stok menipis: {{materialNama}} tersisa {{qtyAvailable}} (batas minimum {{limit}}). Segera lakukan pembelian.',
    },
    {
      eventType: 'approval.requested',
      channel: 'DASHBOARD',
      templateBody:
        'Approval baru diajukan oleh {{requestedByNama}}: {{tipe}}. Menunggu keputusan Owner.',
    },
    {
      eventType: 'approval.decided',
      channel: 'DASHBOARD',
      templateBody: 'Approval {{tipe}} telah diputuskan oleh {{decidedByNama}}: {{status}}.',
    },
    // ---- Fase 11: Reservation Expiry (auto-cancel) ----
    {
      eventType: 'reservation.expired',
      channel: 'WHATSAPP',
      templateBody:
        'Halo {{customerNama}}, pesanan {{orderNumber}} dibatalkan otomatis karena pembayaran DP belum diterima dalam 24 jam. Ingin pesan lagi? Kunjungi mlv.id/pesan atau balas pesan ini. — MLV',
    },
  ];

  for (const t of notificationTemplates) {
    await prisma.notificationTemplate.upsert({
      where: {
        eventType_channel: { eventType: t.eventType, channel: t.channel },
      },
      update: { templateBody: t.templateBody, isActive: true },
      create: { ...t, isActive: true },
    });
    console.log(`  ✅ Template ${t.eventType} → ${t.channel}`);
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
