import { PrismaClient, MemberRole } from '@prisma/client';
import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';

const prisma = new PrismaClient();

async function ensureStorageBucket() {
  const endpoint = process.env.STORAGE_ENDPOINT || 'http://localhost:9000';
  const region = process.env.STORAGE_REGION || 'us-east-1';
  const bucket = process.env.STORAGE_BUCKET || 'findit-private';

  const s3 = new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || 'minioadmin',
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || 'minioadminpassword',
    },
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
  });

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`[Storage] Bucket '${bucket}' already exists.`);
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`[Storage] Successfully created bucket '${bucket}'.`);
    } catch (createErr) {
      console.warn(`[Storage] Warning: Failed to create bucket '${bucket}':`, (createErr as Error).message);
    }
  }
}

async function main() {
  console.log('Seeding database...');

  // 1. Ensure private S3 storage bucket
  await ensureStorageBucket();

  // 2. Seed Campus Organization
  const org = await prisma.organization.upsert({
    where: { slug: 'apex-university' },
    update: {},
    create: {
      name: 'Apex University',
      slug: 'apex-university',
      verifiedEmailDomain: 'apex.edu',
    },
  });
  console.log(`[Seed] Organization ready: ${org.name} (${org.slug})`);

  // 3. Seed 3 Test Users
  const usersData = [
    {
      authSubject: 'google-oauth2|member-a-alice',
      email: 'alice@apex.edu',
      displayName: 'Alice Chen',
      role: MemberRole.MEMBER,
    },
    {
      authSubject: 'google-oauth2|member-b-bob',
      email: 'bob@apex.edu',
      displayName: 'Bob Smith',
      role: MemberRole.MEMBER,
    },
    {
      authSubject: 'google-oauth2|moderator-carol',
      email: 'carol@apex.edu',
      displayName: 'Carol Davis (Safety Office)',
      role: MemberRole.MODERATOR,
    },
  ];

  for (const item of usersData) {
    const user = await prisma.user.upsert({
      where: { email: item.email },
      update: {
        displayName: item.displayName,
        authSubject: item.authSubject,
      },
      create: {
        email: item.email,
        displayName: item.displayName,
        authSubject: item.authSubject,
      },
    });

    await prisma.membership.upsert({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: user.id,
        },
      },
      update: {
        role: item.role,
      },
      create: {
        organizationId: org.id,
        userId: user.id,
        role: item.role,
      },
    });

    console.log(`[Seed] User ready: ${user.displayName} (${item.role})`);
  }

  console.log('Database seed completed successfully.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
