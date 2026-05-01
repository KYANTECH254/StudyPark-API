require('dotenv').config();

const bcrypt = require('bcryptjs');
const prisma = require('./db');
const { buildUserUniversityData } = require('./services/metadataService');

const ADMIN_EMAIL = 'admin@studypark.co.ke';
const ADMIN_PASSWORD = '123456';
const ADMIN_FULL_NAME = 'StudyPark Admin';
const ADMIN_UNIVERSITY = 'StudyPark';

async function seedAdmin() {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, salt);

  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      fullName: ADMIN_FULL_NAME,
      password: hashedPassword,
      isAdmin: true,
      ...(await buildUserUniversityData(prisma, ADMIN_UNIVERSITY))
    },
    create: {
      email: ADMIN_EMAIL,
      fullName: ADMIN_FULL_NAME,
      password: hashedPassword,
      isAdmin: true,
      ...(await buildUserUniversityData(prisma, ADMIN_UNIVERSITY))
    },
  });

  console.log(`[seed] Admin ready: ${user.email}`);
}

async function main() {
  await seedAdmin();
}

main()
  .catch((error) => {
    console.error('[seed] Failed to seed admin user');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
