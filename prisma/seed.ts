import { PrismaClient, MemberRole } from '@prisma/client';
import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { hashPassword } from '../src/lib/password';

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

  // Ensure schema compatibility (password_hash column)
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
    console.log('[Seed] Schema check: password_hash column verified.');
  } catch (schemaErr) {
    console.warn('[Seed] Warning: Schema check skipped:', (schemaErr as Error).message);
  }

  // 1. Ensure private S3 storage bucket
  await ensureStorageBucket();

  // 2. Seed Campus Organization (Apex University for Vitest fixtures)
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

  // 3. Seed 3 Test Users for automated integration tests
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

  // 4. Seed CMR Institute of Technology (CMRIT)
  const cmrit = await prisma.organization.upsert({
    where: { slug: 'cmrit-lost-and-found' },
    update: {
      name: 'CMR Institute of Technology',
      verifiedEmailDomain: 'cmrit.ac.in',
    },
    create: {
      name: 'CMR Institute of Technology',
      slug: 'cmrit-lost-and-found',
      verifiedEmailDomain: 'cmrit.ac.in',
    },
  });
  console.log(`[Seed] Organization ready: ${cmrit.name} (${cmrit.slug})`);

  // Clean any legacy demo reports, images, claims, messages, matches, and jobs for CMRIT
  const cmritReports = await prisma.report.findMany({
    where: { organizationId: cmrit.id },
    select: { id: true },
  });
  const reportIds = cmritReports.map((r) => r.id);

  if (reportIds.length > 0) {
    await prisma.claimMessage.deleteMany({
      where: { claim: { reportId: { in: reportIds } } },
    });
    await prisma.claim.deleteMany({
      where: { reportId: { in: reportIds } },
    });
    await prisma.reportMatch.deleteMany({
      where: {
        OR: [
          { lostReportId: { in: reportIds } },
          { foundReportId: { in: reportIds } },
        ],
      },
    });
    await prisma.reportImage.deleteMany({
      where: { reportId: { in: reportIds } },
    });
    await prisma.moderationReport.deleteMany({
      where: { reportId: { in: reportIds } },
    });
    await prisma.report.deleteMany({
      where: { organizationId: cmrit.id },
    });
    console.log(`[Seed] Purged ${reportIds.length} legacy demo reports from ${cmrit.name}`);
  }

  // Clean old demo jobs
  await prisma.job.deleteMany({
    where: {
      OR: [
        { dedupeKey: { startsWith: 'compute_matches:' } },
        { dedupeKey: { startsWith: 'process_image:' } },
      ],
    },
  });

  // 5. Seed ONE official Admin/Moderator account for CMRIT
  const adminPassword = process.env.ADMIN_PASSWORD || 'CmritAdmin@2026';
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@cmrit.ac.in' },
    update: {
      displayName: 'CMRIT Admin / Security',
      authSubject: 'credentials|admin@cmrit.ac.in',
      passwordHash: hashPassword(adminPassword),
      disabledAt: null,
    },
    create: {
      email: 'admin@cmrit.ac.in',
      displayName: 'CMRIT Admin / Security',
      authSubject: 'credentials|admin@cmrit.ac.in',
      passwordHash: hashPassword(adminPassword),
    },
  });

  await prisma.membership.upsert({
    where: {
      organizationId_userId: {
        organizationId: cmrit.id,
        userId: adminUser.id,
      },
    },
    update: { role: MemberRole.ORG_ADMIN },
    create: {
      organizationId: cmrit.id,
      userId: adminUser.id,
      role: MemberRole.ORG_ADMIN,
    },
  });
  console.log(`[Seed] CMRIT Admin ready: ${adminUser.email} (${adminUser.displayName})`);

  // Remove fake personas from CMRIT organization memberships
  await prisma.membership.deleteMany({
    where: {
      organizationId: cmrit.id,
      user: {
        email: {
          in: ['arjun@cmrit.ac.in', 'priya@cmrit.ac.in', 'security@cmrit.ac.in'],
        },
      },
    },
  });
  await prisma.user.deleteMany({
    where: {
      email: {
        in: ['arjun@cmrit.ac.in', 'priya@cmrit.ac.in', 'security@cmrit.ac.in'],
      },
    },
  });

  console.log('Database seed completed successfully. 0 demo items in CMRIT.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
