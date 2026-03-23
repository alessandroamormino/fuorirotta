import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function buildDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? ''
  if (!url || url.includes('pgbouncer=true')) return url
  return url + (url.includes('?') ? '&' : '?') + 'pgbouncer=true'
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: buildDatabaseUrl(),
    },
  },
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

// Gracefully disconnect on process termination in serverless environments
if (process.env.NODE_ENV === 'production') {
  process.on('beforeExit', async () => {
    await prisma.$disconnect()
  })
}
