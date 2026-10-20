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
    update: {},
    create: {
      name: 'CMR Institute of Technology',
      slug: 'cmrit-lost-and-found',
      verifiedEmailDomain: 'cmrit.ac.in',
    },
  });
  console.log(`[Seed] Organization ready: ${cmrit.name} (${cmrit.slug})`);

  // 5. Seed CMRIT specific student and moderator accounts
  const cmritUsers = [
    {
      authSubject: 'credentials|arjun@cmrit.ac.in',
      email: 'arjun@cmrit.ac.in',
      displayName: 'Arjun Rao',
      role: MemberRole.MEMBER,
    },
    {
      authSubject: 'credentials|priya@cmrit.ac.in',
      email: 'priya@cmrit.ac.in',
      displayName: 'Priya Sharma',
      role: MemberRole.MEMBER,
    },
    {
      authSubject: 'credentials|security@cmrit.ac.in',
      email: 'security@cmrit.ac.in',
      displayName: 'CMRIT Safety Office',
      role: MemberRole.MODERATOR,
    },
  ];

  const createdCmritUsers: Record<string, any> = {};

  for (const item of cmritUsers) {
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
          organizationId: cmrit.id,
          userId: user.id,
        },
      },
      update: { role: item.role },
      create: {
        organizationId: cmrit.id,
        userId: user.id,
        role: item.role,
      },
    });

    createdCmritUsers[item.email] = user;
    console.log(`[Seed] CMRIT User ready: ${user.displayName} (${item.role})`);
  }

  // Grant apex users access to cmrit as well (so test fixtures can cross-reference if needed)
  const allUsers = await prisma.user.findMany();
  for (const u of allUsers) {
    if (!createdCmritUsers[u.email]) {
      const role = u.email === 'carol@apex.edu' ? MemberRole.MODERATOR : MemberRole.MEMBER;
      await prisma.membership.upsert({
        where: {
          organizationId_userId: {
            organizationId: cmrit.id,
            userId: u.id,
          },
        },
        update: { role },
        create: {
          organizationId: cmrit.id,
          userId: u.id,
          role,
        },
      });
    }
  }

  // Seed sample CMRIT items if none exist
  const existingReports = await prisma.report.count({
    where: { organizationId: cmrit.id },
  });

  if (existingReports === 0) {
    const arjun = createdCmritUsers['arjun@cmrit.ac.in'];
    const priya = createdCmritUsers['priya@cmrit.ac.in'];

    // 1. Arjun lost a Casio fx-991CW Calculator in Basic Science Block
    await prisma.report.create({
      data: {
        organizationId: cmrit.id,
        ownerId: arjun.id,
        type: 'LOST',
        category: 'Electronics',
        title: 'Casio fx-991CW Scientific Calculator',
        description: 'Black scientific calculator left on desk in BS-302 during 3rd period Mathematics tutorial.',
        brand: 'Casio',
        color: 'Black',
        locationLabel: 'Basic Science Block Room 302',
        locationArea: 'Basic Science Block',
      },
    });

    // 2. Priya found a College ID Card near Central Library
    await prisma.report.create({
      data: {
        organizationId: cmrit.id,
        ownerId: priya.id,
        type: 'FOUND',
        category: 'Documents',
        title: 'CMRIT Student Smart ID Card (CSE)',
        description: 'Found blue lanyard ID card near library turnstiles. Handed to security reception.',
        brand: 'CMRIT',
        color: 'Blue',
        locationLabel: 'Central Library Turnstiles',
        locationArea: 'Central Library',
      },
    });

    // 3. Priya found a pair of Boat Rockerz Earbuds in Food Court
    await prisma.report.create({
      data: {
        organizationId: cmrit.id,
        ownerId: priya.id,
        type: 'FOUND',
        category: 'Electronics',
        title: 'Boat Airdopes 141 Bluetooth Earbuds (Black)',
        description: 'Left on circular dining table near juice counter. Kept one sticker detail private for claim verification.',
        brand: 'Boat',
        color: 'Black',
        locationLabel: 'Food Court Table 14',
        locationArea: 'Food Court',
      },
    });

    console.log('[Seed] Sample CMRIT reports created successfully.');
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
