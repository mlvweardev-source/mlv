import { prisma } from '@mlv/db';
import { signJwt, ActorType, UserRole } from '@mlv/auth';
import * as fs from 'fs';
import * as path from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-key-for-e2e';
const INITIAL_STOCK = parseInt(process.env.INITIAL_STOCK || '100');
const OUTPUT_PATH = path.join(__dirname, '../../../tests/performance/setup-output.json');

async function setup() {
  console.log('=== k6 Performance Test Setup ===');
  console.log(`Initial stock per material: ${INITIAL_STOCK}`);

  // Clean all order and reservation data
  await prisma.$transaction([
    prisma.activityLog.deleteMany(),
    prisma.orderTimelineEvent.deleteMany(),
    prisma.orderMaterial.deleteMany(),
    prisma.orderService.deleteMany(),
    prisma.orderDesign.deleteMany(),
    prisma.orderSize.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.order.deleteMany(),
    prisma.stockMovement.deleteMany(),
    prisma.stockReservation.deleteMany(),
    prisma.stockBalance.deleteMany(),
  ]);

  const warehouse = await prisma.warehouse.findFirst();
  if (!warehouse) throw new Error('No warehouse found');

  const owner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
  if (!owner) throw new Error('No owner user found');

  const customer = await prisma.customer.findFirst();
  if (!customer) throw new Error('No customer found');

  const materials = await prisma.material.findMany();
  const materialRecords: Record<string, string> = {};
  for (const m of materials) {
    materialRecords[m.nama] = m.id;
    await prisma.stockBalance.create({
      data: {
        materialId: m.id,
        warehouseId: warehouse.id,
        qtyAvailable: INITIAL_STOCK,
        qtyReserved: 0,
      },
    });
  }

  const token = signJwt(
    { sub: owner.id, actorType: ActorType.USER, role: UserRole.OWNER, email: owner.email },
    JWT_SECRET,
    '2h',
  );

  const result = {
    ownerToken: token,
    ownerId: owner.id,
    customerId: customer.id,
    materialId: materialRecords['Kain'],
    warehouseId: warehouse.id,
    initialStock: INITIAL_STOCK,
  };

  // Ensure output directory exists
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));

  console.log('Setup complete.');
  console.log(`Owner ID: ${owner.id}`);
  console.log(`Customer ID: ${customer.id}`);
  console.log(`Kain material ID: ${materialRecords['Kain']}`);
  console.log(`Output: ${OUTPUT_PATH}`);
}

setup()
  .catch((e) => {
    console.error('Setup failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
