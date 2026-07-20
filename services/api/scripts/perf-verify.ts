import { prisma } from '@mlv/db';
import * as fs from 'fs';
import * as path from 'path';

const INITIAL_STOCK = parseInt(process.env.INITIAL_STOCK || '100');
const OUTPUT_PATH = path.join(__dirname, '../../../tests/performance/verification-result.json');

async function verify() {
  console.log('=== k6 Performance Test Verification ===');

  const warehouse = await prisma.warehouse.findFirst();
  if (!warehouse) throw new Error('No warehouse found');

  const kain = await prisma.material.findFirst({ where: { nama: 'Kain' } });
  if (!kain) throw new Error('Kain material not found');

  const balance = await prisma.stockBalance.findUnique({
    where: {
      materialId_warehouseId: {
        materialId: kain.id,
        warehouseId: warehouse.id,
      },
    },
  });
  if (!balance) throw new Error('Stock balance not found');

  const activeReservations = await prisma.stockReservation.findMany({
    where: { materialId: kain.id, status: 'ACTIVE' },
  });

  const totalReserved = activeReservations.reduce((sum, r) => sum + r.qty, 0);

  const orders = await prisma.order.findMany({
    where: { status: { in: ['MENUNGGU_PEMBAYARAN_DP', 'ANTREAN', 'LUNAS'] } },
  });

  console.log('');
  console.log('--- Stock Integrity Report ---');
  console.log(`Initial stock:         ${INITIAL_STOCK}`);
  console.log(`qtyAvailable (final):  ${balance.qtyAvailable}`);
  console.log(`qtyReserved (final):   ${balance.qtyReserved}`);
  console.log(`Active reservations:   ${activeReservations.length}`);
  console.log(`Total reserved qty:    ${totalReserved}`);
  console.log(`Orders created:        ${orders.length}`);
  console.log('');

  const consumed = INITIAL_STOCK - balance.qtyAvailable;
  console.log(`Stock consumed:        ${consumed}`);
  console.log(`Reserved:              ${balance.qtyReserved}`);
  console.log(`Available + Reserved:  ${balance.qtyAvailable + balance.qtyReserved}`);

  const oversold = balance.qtyReserved > INITIAL_STOCK;
  const negativeAvailable = balance.qtyAvailable < 0;
  const mismatch = balance.qtyAvailable + balance.qtyReserved !== INITIAL_STOCK;

  console.log('');
  console.log('--- Integrity Checks ---');
  console.log(`Oversold (reserved > initial): ${oversold ? 'FAIL' : 'PASS'}`);
  console.log(`Negative available:            ${negativeAvailable ? 'FAIL' : 'PASS'}`);
  console.log(`Available + Reserved = Initial: ${mismatch ? 'FAIL' : 'PASS'}`);

  if (oversold || negativeAvailable) {
    console.error('');
    console.error('OVERSELLING DETECTED! Stock integrity compromised.');
    process.exit(1);
  }

  if (mismatch) {
    console.warn('');
    console.warn(
      'WARNING: Available + Reserved != Initial. This may be due to consumed stock (normal for checkout tests).',
    );
  }

  console.log('');
  console.log('Stock integrity verified. No overselling detected.');

  const result = {
    initialStock: INITIAL_STOCK,
    qtyAvailable: balance.qtyAvailable,
    qtyReserved: balance.qtyReserved,
    activeReservations: activeReservations.length,
    totalReservedQty: totalReserved,
    ordersCreated: orders.length,
    oversold,
    negativeAvailable,
  };

  // Ensure output directory exists
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));

  console.log(`Verification result: ${OUTPUT_PATH}`);
}

verify()
  .catch((e) => {
    console.error('Verification failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
