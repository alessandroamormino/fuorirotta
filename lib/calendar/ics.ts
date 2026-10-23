/**
 * Un evento come file iCalendar (RFC 5545), scritto a mano: nessuna
 * dipendenza (decisione di STACK.md). Modulo puro e sicuro nel bundle browser:
 * le lunghezze in ottetti si misurano con TextEncoder, niente API solo-Node.
 *
 * Solo giorni interi: nessuna sorgente porta un orario vero (le date sono
 * mezzanotte UTC o Roma), quindi DTSTART;VALUE=DATE senza VTIMEZONE. Un
 * orario inventato creerebbe voci a mezzanotte nel calendario dell'utente.
 *
 * I giorni escono da eventDays (lib/eventDays.ts), l'unica regola del
 * progetto: valida per il formato UTC di produzione e per quello di Roma.
 * Le stesse CalendarFields alimentano anche i link Google/Outlook (links.ts):
 * file e link non possono divergere.
 *
 * SICUREZZA (T-20-09): titolo, luogo e descrizione sono testo scrapato da
 * siti terzi. Un CR/LF non neutralizzato in SUMMARY permetterebbe a una
 * sorgente di iniettare END:VEVENT o ATTENDEE nel file che l'utente apre.
 * Ogni valore di testo passa SEMPRE da tre passi, in quest'ordine:
 * pulizia dei caratteri di controllo, escape, piegatura a 75 ottetti.
 */
import { decodeHtmlEntities, htmlToPlainText } from '../utils'
import { eventDays } from '../eventDays'
import { nextDateStr } from '../dateWindow'

/** Cio' che serve a un evento per diventare file o link; righe Prisma ed eventi serializzati ci stanno entrambi. */
export interface CalendarSource {
  id: number
  title: string
  description?: string | null
  dateStart: string | Date
  dateEnd?: string | Date | null
  locationName?: string | null
  address?: string | null
  sourceUrl?: string | null
  comune?: { name: string } | null
}

export interface CalendarFields {
  title: string
  /** Vuota quando non si sa nulla del luogo. */
  location: string
  /** Testo semplice: estratto della descrizione, fonte (solo http/https), pagina su Fuorirotta. */
  details: string
  /** Primo giorno, "YYYY-MM-DD" a Roma. */
  startDay: string
  /** Ultimo giorno (incluso), "YYYY-MM-DD" a Roma. */
  endDay: string
  eventUrl: string
}

const DETAILS_MAX = 500

/** Taglia a `max` caratteri (code point) su un confine di parola, con puntini di sospensione. */
function cutAtWord(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  const head = chars.slice(0, max - 1).join('')
  const lastSpace = head.search(/\s\S*$/)
  // Nessuno spazio utile (parola lunghissima): taglio secco.
  return (lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd() + '…'
}

export function calendarFields(event: CalendarSource, eventUrl: string): CalendarFields {
  const title = decodeHtmlEntities(event.title).trim()

  const venue = decodeHtmlEntities(event.locationName ?? '').trim()
  const address = decodeHtmlEntities(event.address ?? '').trim()
  const parts = [venue, address && address !== venue ? address : ''].filter(Boolean)
  const location = parts.length > 0 ? parts.join(', ') : decodeHtmlEntities(event.comune?.name ?? '').trim()

  const snippet = cutAtWord(htmlToPlainText(event.description ?? ''), DETAILS_MAX)
  const tail: string[] = []
  // Solo http(s): un sourceUrl "javascript:" non deve finire in un file che l'utente apre.
  if (event.sourceUrl && /^https?:\/\//i.test(event.sourceUrl)) tail.push(`Fonte: ${event.sourceUrl}`)
  tail.push(eventUrl)
  const details = (snippet ? snippet + '\n\n' : '') + tail.join('\n')

  const { startDay, endDay } = eventDays(event.dateStart, event.dateEnd)
  return { title, location, details, startDay, endDay, eventUrl }
}

const CRLF = '\r\n'
const encoder = new TextEncoder()

/** Passo 1: caratteri di controllo (tranne LF/CR, gestiti dall'escape) e DEL diventano spazi. */
const clean = (s: string) => s.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
/** Passo 2: \ ; , e a capo secondo RFC 5545 §3.3.11. */
const escapeText = (s: string) => s.replace(/[\\;,]/g, '\\$&').replace(/\r\n|\r|\n/g, '\\n')

/** Passo 3: righe a 75 ottetti al massimo, mai in mezzo a una sequenza UTF-8; la continuazione inizia con uno spazio (74 ottetti di carico). */
function fold(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = ''
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const b = encoder.encode(ch).length
    if (bytes + b > limit) {
      out.push(cur)
      cur = ''
      bytes = 0
      limit = 74
    }
    cur += ch
    bytes += b
  }
  out.push(cur)
  return out.join(CRLF + ' ')
}

const compact = (day: string) => day.replace(/-/g, '')
const stampFormat = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

const text = (name: string, value: string) => `${name}:${escapeText(clean(value))}`

/**
 * Le righe di un VEVENT, condivise dal file di un evento e dal feed: i due non
 * possono divergere. Con `alarm`, un VALARM prima di END:VEVENT: TRIGGER -PT6H
 * rispetto al DTSTART di giorno intero sono le 18:00 della sera prima nel
 * fuso di chi guarda il calendario.
 */
function eventLines(fields: CalendarFields, opts: { uid: string; stamp: Date; alarm?: boolean }): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${clean(opts.uid)}`,
    `DTSTAMP:${stampFormat(opts.stamp)}`,
    `DTSTART;VALUE=DATE:${compact(fields.startDay)}`,
    // DTEND dei giorni interi e' ESCLUSIVO: il giorno dopo l'ultimo.
    `DTEND;VALUE=DATE:${compact(nextDateStr(fields.endDay))}`,
    text('SUMMARY', fields.title),
    ...(fields.location ? [text('LOCATION', fields.location)] : []),
    text('DESCRIPTION', fields.details),
    // Valore URI: niente escape del testo, solo pulizia.
    `URL:${clean(fields.eventUrl)}`,
    'TRANSP:TRANSPARENT',
    ...(opts.alarm ? ['BEGIN:VALARM', 'ACTION:DISPLAY', text('DESCRIPTION', fields.title), 'TRIGGER:-PT6H', 'END:VALARM'] : []),
    'END:VEVENT',
  ]
}

const HEADER = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fuorirotta//Eventi//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']

/**
 * Il file .ics di un evento. `uid` e `stamp` sono parametri (non Date.now()):
 * a input fissi l'output e' identico, quindi testabile. L'UID del download
 * singolo e' event-{id}@fuori-rotta.it; il feed in abbonamento NON lo riusa
 * (scelta della fase 22, confermata dall'utente): usa saved-{id della riga
 * salvata}@fuori-rotta.it, che resta uguale per tutta la vita del salvataggio,
 * anche dopo il purge (event_id diventa NULL) e le fusioni (cambia l'id
 * canonico). Il prezzo: chi ha scaricato anche il file singolo vede
 * l'evento due volte nello stesso calendario.
 */
export function buildIcs(fields: CalendarFields, opts: { uid: string; stamp: Date }): string {
  const lines = [...HEADER, ...eventLines(fields, opts), 'END:VCALENDAR']
  return lines.map(fold).join(CRLF) + CRLF
}

/**
 * Il feed in abbonamento: piu' eventi, ognuno con DTSTAMP dal salvataggio
 * (mai l'ora della richiesta: due richieste uguali danno gli stessi byte) e,
 * se `alarm`, il promemoria. REFRESH-INTERVAL e X-PUBLISHED-TTL sono
 * suggerimenti ai client, mai promessi all'utente.
 */
export function buildFeed(
  events: Array<{ fields: CalendarFields; uid: string; stamp: Date; alarm: boolean }>,
  opts: { name: string }
): string {
  const lines = [
    ...HEADER,
    text('X-WR-CALNAME', opts.name),
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    ...events.flatMap((e) => eventLines(e.fields, e)),
    'END:VCALENDAR',
  ]
  return lines.map(fold).join(CRLF) + CRLF
}

// Self-check: `npx tsx lib/calendar/ics.ts`, lanciato da scripts/calendar.test.sh
// sotto quattro fusi orari. La guardia su `typeof` non e' cerimonia: il modulo
// e' raggiungibile da componenti "use client" (links.ts lo importa) e nel
// bundle browser `module` non esiste (check:browser-bundle).
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failures = 0
  const assertCheck = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`  FAIL: ${msg}`)
      failures++
    }
  }
  const unfold = (s: string) => s.replace(/\r\n /g, '')
  const stamp = new Date('2026-10-17T10:20:30.123Z')
  const url = 'https://fuori-rotta.it/eventi/7'
  const base: CalendarSource = {
    id: 7,
    title: 'Sagra',
    dateStart: '2026-10-18T00:00:00.000Z',
    dateEnd: '2026-10-18T23:59:59.999Z',
  }
  const ics = (e: Partial<CalendarSource>, u = url) => buildIcs(calendarFields({ ...base, ...e }, u), { uid: 'event-7@fuori-rotta.it', stamp })

  // DTEND esclusivo: un giorno, intervallo, cambio ora legale, fine anno.
  const dtend = (start: string, end: string | null) =>
    /DTEND;VALUE=DATE:(\d{8})/.exec(ics({ dateStart: start, dateEnd: end }))?.[1]
  assertCheck(dtend('2026-10-18T00:00:00.000Z', '2026-10-18T23:59:59.999Z') === '20261019', 'un giorno: DTEND = giorno dopo')
  assertCheck(dtend('2026-10-18T00:00:00.000Z', '2026-10-19T23:59:59.999Z') === '20261020', 'intervallo: DTEND = giorno dopo la fine')
  assertCheck(dtend('2027-03-28T00:00:00.000Z', '2027-03-28T23:59:59.999Z') === '20270329', 'cambio ora legale 2027-03-28: DTEND 20270329')
  assertCheck(dtend('2026-12-31T00:00:00.000Z', '2026-12-31T23:59:59.999Z') === '20270101', 'fine anno: DTEND 20270101')
  assertCheck(dtend('2027-03-27T23:00:00.000Z', '2027-03-28T21:59:59.999Z') === '20270329', 'formato Roma: DTEND 20270329')
  assertCheck(/DTSTART;VALUE=DATE:20261018\r\n/.test(ics({})), 'DTSTART senza orario, 20261018')

  // UID e DTSTAMP stabili a input fissi.
  assertCheck(ics({}) === ics({}), 'output stabile a input fissi')
  assertCheck(ics({}).includes('UID:event-7@fuori-rotta.it\r\n'), 'UID event-7@fuori-rotta.it')
  assertCheck(ics({}).includes('DTSTAMP:20261017T102030Z\r\n'), 'DTSTAMP 20261017T102030Z')

  // Forma: solo CRLF, righe fino a 75 ottetti.
  const long = Array.from('àé€😀 lorem ipsum dolor sit amet '.repeat(30)).slice(0, 600).join('')
  const body = buildIcs(
    { ...calendarFields({ ...base, title: 'Titolo ' + 'ò'.repeat(120), locationName: 'Piazza ' + 'è'.repeat(100) }, url), details: long },
    { uid: 'u', stamp }
  )
  assertCheck(!/(^|[^\r])\n/.test(body), 'nessun LF nudo')
  assertCheck(!/\r(?!\n)/.test(body), 'nessun CR nudo')
  assertCheck(body.endsWith('\r\n'), 'il file finisce con CRLF')
  const maxOctets = Math.max(...body.split('\r\n').map((l) => encoder.encode(l).length))
  assertCheck(maxOctets <= 75, `riga di ${maxOctets} ottetti (massimo 75)`)
  assertCheck(body.split('\r\n').some((l) => l.startsWith(' ')), 'il fixture lungo e\' stato piegato davvero')

  // Dispiegando si riottiene la descrizione di 600 caratteri, byte per byte.
  assertCheck(Array.from(long).length === 600, 'fixture di 600 caratteri')
  assertCheck(
    unfold(body).split('\r\n').includes('DESCRIPTION:' + escapeText(long)),
    'unfold(fold(DESCRIPTION)) = DESCRIPTION di partenza (multibyte)'
  )

  // Escape: asserzione dedicata, un refuso '\;' una volta ha prodotto un ; non escapato senza che nulla se ne accorgesse.
  const escaped = unfold(ics({ title: 'a;b,c\\d' }))
  assertCheck(escaped.includes('SUMMARY:a\\;b\\,c\\\\d\r\n'), `escape di ; , \\ nel titolo: ${JSON.stringify(escaped.split('\r\n').find((l) => l.startsWith('SUMMARY')))}`)
  assertCheck(unfold(ics({ locationName: 'Via Roma, 1; Parma' })).includes('LOCATION:Via Roma\\, 1\\; Parma\r\n'), 'escape nel luogo')

  // Iniezione: un titolo con CR/LF + END:VEVENT + una proprieta' extra.
  for (const sep of ['\r\n', '\n', '\r']) {
    const evil = ics({ title: `Normale${sep}END:VEVENT${sep}ATTENDEE:mailto:x@example.invalid${sep}BEGIN:VEVENT` })
    const rawLines = evil.split('\r\n')
    assertCheck(rawLines.filter((l) => l === 'END:VEVENT').length === 1, `iniezione (${JSON.stringify(sep)}): esattamente un END:VEVENT`)
    assertCheck(rawLines.filter((l) => l === 'BEGIN:VEVENT').length === 1, `iniezione (${JSON.stringify(sep)}): esattamente un BEGIN:VEVENT`)
    assertCheck(!rawLines.some((l) => l.startsWith('ATTENDEE')), `iniezione (${JSON.stringify(sep)}): nessuna riga ATTENDEE`)
    assertCheck(!unfold(evil).split('\r\n').some((l) => l.startsWith('ATTENDEE')), `iniezione (${JSON.stringify(sep)}): nessuna ATTENDEE dopo il dispiegamento`)
  }
  assertCheck(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(ics({ title: 'a\u0000b\u007fc\u001bd' })), 'caratteri di controllo ripuliti')

  // calendarFields: titolo, luogo, dettagli.
  const f1 = calendarFields({ ...base, title: '  Sagra &amp; musica  ', locationName: 'Piazza Verdi', address: 'Via Roma 1' }, url)
  assertCheck(f1.title === 'Sagra & musica', `titolo decodificato: "${f1.title}"`)
  assertCheck(f1.location === 'Piazza Verdi, Via Roma 1', `luogo: "${f1.location}"`)
  assertCheck(calendarFields({ ...base, locationName: 'Piazza', address: 'Piazza' }, url).location === 'Piazza', 'indirizzo uguale al luogo saltato')
  assertCheck(calendarFields({ ...base, comune: { name: 'Parma' } }, url).location === 'Parma', 'ripiego sul comune')
  assertCheck(calendarFields(base, url).location === '', 'luogo ignoto: stringa vuota')
  assertCheck(!ics({}).includes('LOCATION'), 'nessuna riga LOCATION se il luogo e\' ignoto')

  const longWords = 'parola '.repeat(200)
  const f2 = calendarFields({ ...base, description: `<p>${longWords}</p>`, sourceUrl: 'https://example.invalid/x' }, url)
  const snippet = f2.details.split('\n\nFonte: ')[0]
  assertCheck(Array.from(snippet).length <= DETAILS_MAX, `estratto di ${Array.from(snippet).length} caratteri (massimo ${DETAILS_MAX})`)
  assertCheck(snippet.endsWith('parola…'), 'estratto tagliato su confine di parola con puntini')
  assertCheck(f2.details.endsWith(`Fonte: https://example.invalid/x\n${url}`), 'fonte e pagina Fuorirotta in coda ai dettagli')
  assertCheck(calendarFields({ ...base, sourceUrl: 'javascript:alert(1)' }, url).details === url, 'sourceUrl javascript: lasciato fuori')
  assertCheck(!ics({ sourceUrl: 'javascript:alert(1)' }).includes('javascript'), 'javascript: assente dal file')
  assertCheck(calendarFields({ ...base, description: 'Breve' }, url).details === `Breve\n\n${url}`, 'estratto breve non tagliato')

  // Feed: zero eventi, due eventi con un solo promemoria, iniezione, forma, stabilita'.
  const fieldsOf = (e: Partial<CalendarSource>) => calendarFields({ ...base, ...e }, url)
  const feedOf = (name: string, evs: Array<{ fields: CalendarFields; alarm: boolean }>) =>
    buildFeed(evs.map((e, i) => ({ ...e, uid: `saved-${i + 1}@fuori-rotta.it`, stamp })), { name })
  const count = (body: string, line: string) => body.split('\r\n').filter((l) => l === line).length
  const empty = feedOf('Fuorirotta - Salvati', [])
  assertCheck(count(empty, 'BEGIN:VCALENDAR') === 1 && count(empty, 'END:VCALENDAR') === 1, 'feed vuoto: un solo VCALENDAR')
  assertCheck(count(empty, 'BEGIN:VEVENT') === 0, 'feed vuoto: nessun VEVENT')
  const two = feedOf('Fuorirotta - Salvati', [
    { fields: fieldsOf({ title: 'Uno' }), alarm: true },
    { fields: fieldsOf({ title: 'Due; con, virgole' }), alarm: false },
  ])
  assertCheck(count(two, 'BEGIN:VEVENT') === 2 && count(two, 'END:VEVENT') === 2, 'feed: due VEVENT')
  assertCheck(count(two, 'BEGIN:VALARM') === 1 && count(two, 'END:VALARM') === 1, 'feed: un solo VALARM (solo uno ha alarm)')
  assertCheck(two.includes('TRIGGER:-PT6H\r\n') && two.includes('ACTION:DISPLAY\r\n'), 'feed: TRIGGER:-PT6H e ACTION:DISPLAY')
  assertCheck(two.includes('X-WR-CALNAME:Fuorirotta - Salvati\r\n'), 'feed: nome del calendario')
  assertCheck(feedOf('x', [{ fields: fieldsOf({}), alarm: true }]).includes('DESCRIPTION:Sagra\r\nTRIGGER'), 'VALARM: DESCRIPTION e\' il titolo')
  for (const sep of ['\r\n', '\n', '\r']) {
    const evil = `Cattivo${sep}END:VEVENT${sep}ATTENDEE:mailto:x@example.invalid${sep}BEGIN:VALARM`
    const feed = feedOf(evil, [{ fields: fieldsOf({ title: evil }), alarm: true }])
    const lines = feed.split('\r\n')
    const tag = JSON.stringify(sep)
    assertCheck(count(feed, 'BEGIN:VEVENT') === 1 && count(feed, 'END:VEVENT') === 1, `feed, iniezione (${tag}): un solo VEVENT`)
    assertCheck(count(feed, 'BEGIN:VALARM') === 1 && count(feed, 'END:VALARM') === 1, `feed, iniezione (${tag}): un solo VALARM`)
    assertCheck(!lines.some((l) => l.startsWith('ATTENDEE')), `feed, iniezione (${tag}): nessuna ATTENDEE`)
    assertCheck(!unfold(feed).split('\r\n').some((l) => l.startsWith('ATTENDEE')), `feed, iniezione (${tag}): nessuna ATTENDEE dopo il dispiegamento`)
  }
  const longFeed = feedOf('Nome ' + 'ò'.repeat(120), [{ fields: fieldsOf({ title: 'T' + 'è'.repeat(120), description: 'parola '.repeat(200) }), alarm: true }])
  assertCheck(!/(^|[^\r])\n/.test(longFeed) && !/\r(?!\n)/.test(longFeed), 'feed: solo CRLF')
  assertCheck(Math.max(...longFeed.split('\r\n').map((l) => encoder.encode(l).length)) <= 75, 'feed: righe fino a 75 ottetti')
  assertCheck(feedOf('a', [{ fields: fieldsOf({}), alarm: true }]) === feedOf('a', [{ fields: fieldsOf({}), alarm: true }]), 'feed stabile a input fissi')

  if (failures > 0) {
    console.error(`[ics.ts] ${failures} verifiche fallite`)
    process.exit(1)
  }
  console.log('[ics.ts] self-check OK')
}
