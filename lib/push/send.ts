import { prisma } from '../prisma'
import { sendBatch, type ApnsOutcome, type DeviceReport, type PushMessage } from './apns'
import type { ApnsEnvironment } from '../api-contract'

// Notifiche push (Fase 26, API-03): la meta' del mittente che parla col database. Solo server, mai importato
// da una route o da codice client (nessun endpoint puo' mandare un push, D-11): la fase 28 lo chiama dal
// container del cron, il terminale dallo script scripts/send-test-push.ts.
//
// Invia a TUTTI i dispositivi di un utente (D-09) e cancella da push_devices solo quelli che Apple ha
// dichiarato morti NELLA STESSA esecuzione (deadIds di sendBatch). La cancellazione e' una sola, alla fine:
// un'esecuzione interrotta non cancella nulla. Per un 410 vale la guardia sul timestamp di Apple: se
// l'app ha ri-registrato lo stesso token DOPO (last_seen_at piu' recente), la riga resta.

export type PushReport = {
  sent: number
  pruned: number
  retry: number
  rejected: number
  config: number
  skipped: number
  byDevice: DeviceReport[]
}

export async function sendToUser(
  userId: string,
  message: PushMessage,
  opts: { env?: Record<string, string | undefined>; origins?: Record<ApnsEnvironment, string>; now?: number; timeoutMs?: number } = {},
): Promise<PushReport> {
  const rows = await prisma.pushDevice.findMany({
    where: { userId },
    select: { id: true, deviceToken: true, environment: true },
    orderBy: { id: 'asc' },
  })
  const report: PushReport = { sent: 0, pruned: 0, retry: 0, rejected: 0, config: 0, skipped: 0, byDevice: [] }
  if (rows.length === 0) return report

  const { byDevice, deadIds } = await sendBatch(rows, message, opts)
  report.byDevice = byDevice
  const count: Partial<Record<ApnsOutcome, number>> = {}
  for (const d of byDevice) count[d.outcome] = (count[d.outcome] ?? 0) + 1
  report.sent = count.sent ?? 0
  report.retry = count.retry ?? 0
  report.config = count.config ?? 0
  report.skipped = count.skipped ?? 0
  // un 'not-for-topic' che non e' stato potato (nessun 200 nel lotto) conta fra i rifiuti
  report.rejected = (count.rejected ?? 0) + (count['not-for-topic'] ?? 0) - byDevice.filter((d) => d.outcome === 'not-for-topic' && deadIds.includes(d.id)).length

  if (deadIds.length > 0) {
    const byId = new Map(byDevice.map((d) => [d.id, d]))
    const { count: pruned } = await prisma.pushDevice.deleteMany({
      where: {
        OR: deadIds.map((id) => {
          const d = byId.get(id)
          return d?.status === 410 && typeof d.timestamp === 'number'
            ? { id, userId, lastSeenAt: { lte: new Date(d.timestamp) } }
            : { id, userId }
        }),
      },
    })
    report.pruned = pruned
  }
  console.info(`push: utente con ${rows.length} dispositivi, inviati ${report.sent}, potati ${report.pruned}, da ritentare ${report.retry}`)
  return report
}
