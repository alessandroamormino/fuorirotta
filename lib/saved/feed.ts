/**
 * Il feed del calendario dell'account (CAL-03, D-11..D-14). Solo server:
 * node:crypto vive qui e non in lib/calendar/ics.ts (raggiungibile dal browser).
 *
 * L'indirizzo /cal/{token}.ics e' una capability: chi lo ha legge la lista.
 * Ogni risposta che non sia un feed vivo (nome malformato, token ignoto o
 * ruotato, accesso spento) e' la STESSA feedNotFound(): nessuna differenza
 * osservabile fra "non esiste" e "non piu' valido" (22-RESEARCH Pitfall 8).
 */
import { randomBytes } from 'node:crypto'
import { buildFeed, calendarFields, type CalendarSource } from '../calendar/ics'
import { canonicalEventUrl } from '../events/getComposedEvent'
import { listAccountItems } from './resolve'
import { buildSavedView } from './view'

/** 22 caratteri base64url (128 bit) e .ics. */
export const FEED_FILE = /^[A-Za-z0-9_-]{22}\.ics$/

/** Giorni dopo la fine in cui un evento resta nel calendario. */
const KEEP_PAST_DAYS = 30

export function feedNotFound(): Response {
  return new Response('Not found\n', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' },
  })
}

export function newFeedToken(): string {
  return randomBytes(16).toString('base64url')
}

const romeDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' })

/** "YYYY-MM-DD" meno `days` giorni, aritmetica pura sul calendario. */
function minusDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10)
}

const siteBase = () => (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'https://fuori-rotta.it').replace(/\/$/, '')

export async function buildUserFeed(userId: string, now: Date): Promise<string> {
  const items = await listAccountItems(userId)
  const sourceUrls = new Map(items.map((i) => [i.ref, (i.live ?? i.snap)?.sourceUrl ?? null]))
  const { upcoming, past } = buildSavedView(items, now)
  const today = romeDayFormat.format(now)
  const oldest = minusDays(today, KEEP_PAST_DAYS)

  const events = [...upcoming, ...past].flatMap((row) => {
    const sourceUrl = sourceUrls.get(row.ref) ?? null
    const source: CalendarSource = {
      id: row.ref,
      title: row.title,
      dateStart: row.dateStart,
      dateEnd: row.dateEnd,
      locationName: row.place,
      sourceUrl,
    }
    // Riga viva: pagina dell'evento; sparita: la fonte se http(s), altrimenti /salvati.
    const eventUrl =
      row.eventId !== null
        ? canonicalEventUrl(row.eventId)
        : sourceUrl && /^https?:\/\//i.test(sourceUrl)
          ? sourceUrl
          : `${siteBase()}/salvati`
    const fields = calendarFields(source, eventUrl)
    // Finiti da piu' di 30 giorni escono dal calendario (D-14): l'ultimo giorno inclusivo conta.
    if (fields.endDay < oldest) return []
    return [
      {
        fields,
        // Stabile per tutta la vita del salvataggio: purge e fusioni non lo toccano (decisione Task 1, 22-07).
        uid: `saved-${row.ref}@fuori-rotta.it`,
        stamp: new Date(row.savedAt),
        alarm: fields.startDay > today,
        ref: row.ref,
      },
    ]
  })
  events.sort((a, b) => (a.fields.startDay < b.fields.startDay ? -1 : a.fields.startDay > b.fields.startDay ? 1 : a.ref - b.ref))
  return buildFeed(events, { name: 'Fuorirotta - Salvati' })
}
