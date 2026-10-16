import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client'
import { getConnectionLimit } from './scrapers/connectionLimit'
import { SUPABASE_ROOT_CA } from './supabaseCa'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Prisma 7 parla al database con node-postgres (driver adapter), non piu'
// col motore Rust. Tre comportamenti del motore vecchio vanno riportati a
// mano, altrimenti cambiano in silenzio:
//
// - Pool: la dimensione la dichiara `connection_limit` nella DATABASE_URL di
//   produzione, la stessa da cui lib/scrapers/connectionLimit.ts deriva i
//   batch. pg non legge quel parametro: va passato come `max`.
// - Timeout di connessione: 5s come Prisma 6. pg di default aspetta per
//   sempre, e un pooler irraggiungibile bloccherebbe una richiesta a tempo
//   indeterminato invece di fallire.
// - TLS: il motore Rust cifrava verso Supabase senza validare il
//   certificato. pg valida — certificato e nome host — contro la CA di
//   Supabase (lib/supabaseCa.ts), che Node da solo non conosce: ora la
//   connessione e' cifrata E autenticata, non solo cifrata. Il Postgres
//   locale di sviluppo non ha TLS.
//
// I parametri che capiva solo Prisma (pgbouncer, connection_limit,
// pool_timeout) e sslmode escono dall'URL: pg applicherebbe sslmode
// SOPRA l'opzione `ssl` qui sotto, annullandola.
const PRISMA_ONLY_PARAMS = ['pgbouncer', 'connection_limit', 'pool_timeout', 'sslmode']
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal'])

function buildAdapter(databaseUrl = process.env.DATABASE_URL ?? ''): PrismaPg {
  let connectionString = databaseUrl
  let ssl: false | { ca: string } = false
  try {
    const url = new URL(databaseUrl)
    const sslDisabled = url.searchParams.get('sslmode') === 'disable'
    for (const param of PRISMA_ONLY_PARAMS) url.searchParams.delete(param)
    connectionString = url.toString()
    ssl = sslDisabled || LOCAL_HOSTS.has(url.hostname) ? false : { ca: SUPABASE_ROOT_CA }
  } catch {
    // URL assente o malformata: la passa cosi' com'e', e l'errore arriva
    // dal driver alla prima query, con il suo messaggio.
  }
  return new PrismaPg({
    connectionString,
    ssl,
    max: getConnectionLimit(databaseUrl),
    connectionTimeoutMillis: 5_000,
  })
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  adapter: buildAdapter(),
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
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
