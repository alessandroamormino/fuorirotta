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
  },
  {
    table: 'share_links',
    exportKey: 'shareLink',
    // Del link di condivisione si esporta quando e' nato, quando e' stato rigenerato e se mostra il
    // nome: MAI il link stesso, che resterebbe nel file scaricato come un secondo modo per aprire la lista.
    exportRows: async (userId) =>
      prisma.shareLink.findMany({
        where: { userId },
        select: { createdAt: true, rotatedAt: true, showName: true }
      })
  },
  {
    table: 'user_follows',
    exportKey: 'follows',
    // Niente id interni: cosa segue (kind, key) e da quando.
    exportRows: async (userId) =>
      prisma.userFollow.findMany({
        where: { userId },
        select: { kind: true, key: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      })
  },
  {
    table: 'push_devices',
    exportKey: 'pushDevices',
    // Per ogni dispositivo si esporta quale build riceve le notifiche (sandbox o production), la versione
    // dell'app e da quando: MAI l'identificativo del dispositivo, che non e' un contenuto dell'utente e
    // sopravvivrebbe all'account nel file scaricato.
    exportRows: async (userId) =>
      prisma.pushDevice.findMany({
        where: { userId },
        select: { environment: true, appVersion: true, createdAt: true, lastSeenAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      })
  },
  {
    table: 'user_preferences',
    exportKey: 'preferences',
    // onboardedAt dice solo che la finestra di benvenuto e' stata mostrata: nessun consenso e' registrato.
    exportRows: async (userId) =>
      prisma.userPreference.findMany({
        where: { userId },
        select: { onboardedAt: true }
      })
  }
]
