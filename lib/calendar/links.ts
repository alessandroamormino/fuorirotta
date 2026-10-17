/**
 * Link "aggiungi al calendario" (Google, Outlook web) e testo di condivisione.
 * Modulo puro, importato da componenti "use client" (piano 20-05): nessuna
 * API solo-Node, nessun database, nessun import della dedup.
 *
 * I link nascono dalle stesse CalendarFields del file .ics (ics.ts): un
 * evento ha gli stessi giorni nel file, in Google e in Outlook. Nessun OAuth e
 * nessun permesso Google (CAL-02): sono URL pre-compilati che l'utente apre.
 * Gli URL si costruiscono con URL/URLSearchParams, mai concatenando stringhe
 * (T-20-13).
 *
 * `todayDay` e' un parametro: chi chiama passa todayInRome() al click o nel
 * render lato server. Mai calcolarlo dentro un render client: l'ora cambierebbe
 * tra server e browser (React error 418, 2026-10-16).
 */
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { decodeHtmlEntities } from '../utils'
import { eventDays, dayToLocalDate } from '../eventDays'
import { nextDateStr } from '../dateWindow'
import type { CalendarFields } from './ics'

const fmt = (day: string, pattern: string) => format(dayToLocalDate(day), pattern, { locale: it })

/**
 * "dom 18 ott", "sab 17 – dom 18 ott", "sab 31 ott – dom 1 nov". L'anno si
 * aggiunge solo se la fine cade in un anno diverso da quello di `todayDay`;
 * se inizio e fine sono in anni diversi l'anno sta su entrambi i lati.
 */
export function formatDayRange(startDay: string, endDay: string, todayDay: string): string {
  const startYear = startDay.slice(0, 4)
  const endYear = endDay.slice(0, 4)
  if (startYear !== endYear) {
    return `${fmt(startDay, 'EEE d MMM yyyy')} – ${fmt(endDay, 'EEE d MMM yyyy')}`
  }
  const year = endYear !== todayDay.slice(0, 4) ? ` ${endYear}` : ''
  if (startDay === endDay) return `${fmt(startDay, 'EEE d MMM')}${year}`
  if (startDay.slice(0, 7) === endDay.slice(0, 7)) {
    return `${fmt(startDay, 'EEE d')} – ${fmt(endDay, 'EEE d MMM')}${year}`
  }
  return `${fmt(startDay, 'EEE d MMM')} – ${fmt(endDay, 'EEE d MMM')}${year}`
}

/**
 * "{titolo} · {date} · {luogo}" (D-06). Il luogo salta se vuoto. L'URL non e'
 * mai nel testo: navigator.share lo riceve a parte (D-07).
 */
export function shareText(
  input: { title: string; dateStart: string | Date; dateEnd?: string | Date | null; place?: string | null },
  todayDay: string
): string {
  const { startDay, endDay } = eventDays(input.dateStart, input.dateEnd)
  const place = decodeHtmlEntities(input.place ?? '').trim()
  return [decodeHtmlEntities(input.title).trim(), formatDayRange(startDay, endDay, todayDay), place]
    .filter(Boolean)
    .join(' \u00b7 ')
}

const compact = (day: string) => day.replace(/-/g, '')

/** Modulo "Aggiungi evento" di Google Calendar, a giorni interi (la fine di Google e' il giorno DOPO l'ultimo). */
export function googleCalendarUrl(fields: CalendarFields): string {
  const u = new URL('https://calendar.google.com/calendar/render')
  u.searchParams.set('action', 'TEMPLATE')
  u.searchParams.set('text', fields.title)
  u.searchParams.set('dates', `${compact(fields.startDay)}/${compact(nextDateStr(fields.endDay))}`)
  u.searchParams.set('details', fields.details)
  if (fields.location) u.searchParams.set('location', fields.location)
  // Niente ctz: valori senza orario.
  return u.toString()
}

/** Outlook web (account personali). */
export function outlookCalendarUrl(fields: CalendarFields): string {
  const u = new URL('https://outlook.live.com/calendar/deeplink/compose')
  u.searchParams.set('path', '/calendar/action/compose')
  u.searchParams.set('rru', 'addevent')
  u.searchParams.set('subject', fields.title)
  u.searchParams.set('startdt', fields.startDay)
  // ponytail: enddt esclusivo e' un'ipotesi (RESEARCH A2: la fonte non lo dice).
  // Si decide nell'UAT di Outlook web su un evento di piu' giorni: se mostra un
  // giorno di troppo, enddt diventa fields.endDay e l'asserzione dedicata si inverte.
  u.searchParams.set('enddt', nextDateStr(fields.endDay))
  u.searchParams.set('allday', 'true')
  u.searchParams.set('body', fields.details)
  if (fields.location) u.searchParams.set('location', fields.location)
  return u.toString()
}

// Self-check: `npx tsx lib/calendar/links.ts`, lanciato da scripts/calendar.test.sh
// sotto quattro fusi orari. Scritto prima dell'implementazione e visto rosso
// (TDD). La guardia su `typeof` non e' cerimonia: il modulo e' importato da
// componenti "use client" e nel bundle browser `module` non esiste.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failures = 0
  const assertCheck = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`  FAIL: ${msg}`)
      failures++
    }
  }
  const today = '2026-10-16'
  const range = (a: string, b: string, expected: string) => {
    const got = formatDayRange(a, b, today)
    assertCheck(got === expected, `formatDayRange(${a}, ${b}) atteso "${expected}", ottenuto "${got}"`)
  }
  range('2026-10-18', '2026-10-18', 'dom 18 ott')
  range('2026-10-17', '2026-10-18', 'sab 17 – dom 18 ott')
  range('2026-10-31', '2026-11-01', 'sab 31 ott – dom 1 nov')
  range('2027-01-09', '2027-01-10', 'sab 9 – dom 10 gen 2027')
  range('2026-12-31', '2027-01-01', 'gio 31 dic 2026 – ven 1 gen 2027')
  range('2027-01-10', '2027-01-10', 'dom 10 gen 2027')

  // shareText: dal formato di produzione e da quello di Roma, mai l'URL nel testo.
  const prod = { title: 'Sagra &amp; musica', dateStart: '2026-10-17T00:00:00.000Z', dateEnd: '2026-10-18T23:59:59.999Z' }
  assertCheck(shareText({ ...prod, place: 'Vigolzone' }, today) === 'Sagra & musica · sab 17 – dom 18 ott · Vigolzone', `shareText: "${shareText({ ...prod, place: 'Vigolzone' }, today)}"`)
  const noPlace = shareText({ ...prod, place: '' }, today)
  assertCheck(noPlace === 'Sagra & musica · sab 17 – dom 18 ott', `shareText senza luogo: "${noPlace}"`)
  assertCheck(noPlace.split(' · ').length === 2, 'shareText senza luogo: un solo separatore, nessuno in coda')
  assertCheck(shareText({ ...prod, place: null }, today) === noPlace, 'luogo null come luogo vuoto')
  assertCheck(!/http/.test(shareText({ ...prod, place: 'Vigolzone' }, today)), 'shareText non contiene mai un URL')
  assertCheck(
    shareText({ title: 'Romano', dateStart: '2026-10-16T22:00:00.000Z', dateEnd: '2026-10-17T21:59:59.999Z' }, today) === 'Romano · sab 17 ott',
    'shareText, formato Roma: un giorno'
  )

  // Google Calendar.
  const f: CalendarFields = {
    title: 'Sagra & musica, è bella',
    location: 'Piazza Verdi, Parma',
    details: 'Un estratto.\n\nFonte: https://example.invalid/x\nhttps://fuori-rotta.it/eventi/7',
    startDay: '2027-03-28',
    endDay: '2027-03-28',
    eventUrl: 'https://fuori-rotta.it/eventi/7',
  }
  const g = new URL(googleCalendarUrl(f))
  assertCheck(g.host === 'calendar.google.com' && g.pathname === '/calendar/render', `Google host/path: ${g.host}${g.pathname}`)
  assertCheck(g.searchParams.get('action') === 'TEMPLATE', 'Google action=TEMPLATE')
  assertCheck(g.searchParams.get('dates') === '20270328/20270329', `Google dates: ${g.searchParams.get('dates')}`)
  assertCheck(g.searchParams.get('text') === f.title, `Google text round-trip: ${g.searchParams.get('text')}`)
  assertCheck(g.searchParams.get('location') === f.location, 'Google location')
  assertCheck(g.searchParams.get('details') === f.details, 'Google details con fonte e pagina Fuorirotta')
  assertCheck(!g.searchParams.has('ctz'), 'Google senza ctz (date senza orario)')
  assertCheck(!new URL(googleCalendarUrl({ ...f, location: '' })).searchParams.has('location'), 'Google senza location se vuota')
  const gRange = new URL(googleCalendarUrl({ ...f, startDay: '2026-12-30', endDay: '2026-12-31' }))
  assertCheck(gRange.searchParams.get('dates') === '20261230/20270101', `Google, fine anno: ${gRange.searchParams.get('dates')}`)

  // Outlook web.
  const o = new URL(outlookCalendarUrl(f))
  assertCheck(o.host === 'outlook.live.com' && o.pathname === '/calendar/deeplink/compose', `Outlook host/path: ${o.host}${o.pathname}`)
  assertCheck(o.searchParams.get('path') === '/calendar/action/compose', 'Outlook path=/calendar/action/compose')
  assertCheck(o.searchParams.get('rru') === 'addevent', 'Outlook rru=addevent')
  assertCheck(o.searchParams.get('allday') === 'true', 'Outlook allday=true')
  assertCheck(o.searchParams.get('startdt') === '2027-03-28' && o.searchParams.get('enddt') === '2027-03-29', `Outlook startdt/enddt: ${o.searchParams.get('startdt')} / ${o.searchParams.get('enddt')}`)
  assertCheck(o.searchParams.get('subject') === f.title, 'Outlook subject round-trip')
  assertCheck(o.searchParams.get('location') === f.location && o.searchParams.get('body') === f.details, 'Outlook location e body')

  if (failures > 0) {
    console.error(`[links.ts] ${failures} verifiche fallite`)
    process.exit(1)
  }
  console.log('[links.ts] self-check OK')
}
