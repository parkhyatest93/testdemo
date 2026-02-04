import pkg from '@prisma/client';
const { PrismaClient } = pkg;

let prisma: InstanceType<typeof PrismaClient>;

declare global {
  // eslint-disable-next-line no-var
  var __db__: InstanceType<typeof PrismaClient> | undefined;
}

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  if (!globalThis.__db__) {
    globalThis.__db__ = new PrismaClient();
  }
  prisma = globalThis.__db__;
}

export { prisma };
export default prisma;