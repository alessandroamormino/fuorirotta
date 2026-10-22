// Registro dei dati dell'utente: l'UNICA lista delle tabelle figlie di
// auth_user. La rotta di export (piano 21-05) la scorre per costruire il file
// JSON, e `npm run check:user-data` la confronta con il database: una fase
// successiva che aggiunge una tabella con user_id senza registrarla qui, o
// senza ON DELETE CASCADE, fa diventare rosso il gate (invariante della
// milestone, D-12).
//
// Il profilo (auth_user) e' la radice ed e' esportato dalla rotta, non sta qui.
// Le selezioni sono ESPLICITE: sessioni e account hanno colonne segrete (token,
// password) che non devono mai finire in un export.
import { prisma } from '../prisma'

export type UserDataEntry = {
  table: string
  exportKey: string
  exportRows: (userId: string, currentSessionId: string | null) => Promise<Record<string, unknown>[]>
}

export const USER_DATA_REGISTRY: readonly UserDataEntry[] = [
  {
    table: 'auth_session',
    exportKey: 'sessions',
    exportRows: async (userId, currentSessionId) => {
      const rows = await prisma.session.findMany({
        where: { userId },
        select: { id: true, userAgent: true, ipAddress: true, createdAt: true, updatedAt: true, expiresAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
      })
      // l'id serve solo per il flag `current` e non viene restituito
      return rows.map((row) => ({
        userAgent: row.userAgent,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt,
        lastActive: row.updatedAt,
        expiresAt: row.expiresAt,
        current: row.id === currentSessionId
      }))
    }
  },
  {
    table: 'auth_account',
    exportKey: 'linkedAccounts',
    exportRows: async (userId) => {
      const rows = await prisma.account.findMany({
        where: { userId },
        select: { providerId: true, accountId: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      })
      return rows.map((row) => ({
        provider: row.providerId,
        providerAccountId: row.accountId,
        createdAt: row.createdAt
      }))
    }
  },
  {
    table: 'saved_events',
    exportKey: 'savedEvents',
    // Solo le colonne che l'utente ha scelto o che descrivono l'evento: niente id interni.
    exportRows: async (userId) =>
      prisma.savedEvent.findMany({
        where: { userId },
        select: { title: true, dateStart: true, dateEnd: true, place: true, category: true, sourceUrl: true, savedAt: true },
        orderBy: [{ savedAt: 'asc' }, { id: 'asc' }]
      })
  },
  {
    table: 'calendar_feeds',
    exportKey: 'calendarFeed',
    // Del link del calendario si esporta quando e' nato e quando e' stato rigenerato, MAI il link
    // stesso: il file scaricato diventerebbe un secondo modo per leggere la lista (D-13).
    exportRows: async (userId) =>
      prisma.calendarFeed.findMany({
        where: { userId },
        select: { createdAt: true, rotatedAt: true }
      })
  }
]
