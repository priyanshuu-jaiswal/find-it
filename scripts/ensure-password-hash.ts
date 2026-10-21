import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('[Schema] Checking/adding password_hash column to users table...');
    await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
    console.log('[Schema] Successfully verified password_hash column on users table.');
  } catch (err) {
    console.error('[Schema] Failed to alter table:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
