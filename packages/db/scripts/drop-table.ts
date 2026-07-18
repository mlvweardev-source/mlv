import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Dropping product_price_list table if it exists...');
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "product_price_list" CASCADE;`);
  console.log('Table dropped successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
