import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('[Schema] Checking/adding password_hash column to users table...');
    await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
    console.log('[Schema] Checking/adding cleanup retry columns to report_images table...');
    await prisma.$executeRawUnsafe(`ALTER TABLE report_images ADD COLUMN IF NOT EXISTS cleanup_attempts INTEGER NOT NULL DEFAULT 0;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE report_images ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS report_images_cleanup_idx ON report_images(next_retry_at, created_at);`);
    console.log('[Schema] Dropping unique constraint on thumb_object_key to permit database base64 thumbnails...');
    await prisma.$executeRawUnsafe(`ALTER TABLE report_images DROP CONSTRAINT IF EXISTS report_images_thumb_object_key_key;`);
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS report_images_thumb_object_key_key;`);
    console.log('[Schema] Successfully verified required schema columns and indexes.');
  } catch (err) {
    console.error('[Schema] Failed to alter table:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
