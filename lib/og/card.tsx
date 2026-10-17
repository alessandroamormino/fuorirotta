/**
 * Layout della card Open Graph 1200x630 per gli eventi senza immagine
 * (UI-SPEC, Surface 4) e regole sul testo. Ogni valore visivo arriva da
 * OG_BRAND (lib/og/brand.ts): il restyling del marchio cambia quei valori,
 * non questo file.
 *
 * Satori vuole display flex su ogni elemento con piu' di un figlio e non
 * legge le variabili CSS.
 */
import { eventDays } from '../eventDays'
import { formatDayRange } from '../calendar/links'
import { decodeHtmlEntities } from '../utils'
import { categoryVisual } from '../categories/visuals'
import { OG_BRAND } from './brand'

export interface OgSource {
  title: string
  dateStart: string | Date
  dateEnd?: string | Date | null
  canonicalCategory?: string | null
  comune?: { name: string } | null
}

export interface OgCardContent {
  kicker: string
  title: string
  meta: string
  alt: string
  bandColor: string
}

const MAX_TITLE = 90
const MAX_META = 50

/**
 * Entita' decodificate, accenti ricomposti (NFC: il testo scrapato puo' essere
 * decomposto), poi solo scrittura latina, cifre, punteggiatura, valute, i
 * simboli ASCII (+ = < > ~ |), il grado e gli spazi, tutto sotto
 * U+2C00 (il resto Bricolage non lo ha). Un glifo
 * assente fa scaricare a Satori un font o un emoji da un CDN a ogni render
 * (T-20-21): meglio toglierlo qui. Newline e tab diventano spazi prima del
 * filtro, cosi' due parole non si fondono.
 */
function clean(text: string): string {
  return decodeHtmlEntities(text)
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{Script=Latin}\p{Nd}\p{P}\p{Sc}\p{Zs}+=<>~|\u00b0]/gu, '')
    .replace(/[^\u0000-\u2bff]/gu, '')
    .replace(/ +/g, ' ')
    .trim()
}

/** Oltre 90 caratteri: taglio all'ultimo spazio entro il 91esimo e un'ellissi (il titolo ha una sola misura, 64px). */
function clip(title: string): string {
  if (title.length <= MAX_TITLE) return title
  const head = title.slice(0, MAX_TITLE + 1)
  const space = head.lastIndexOf(' ')
  return `${(space > 0 ? head.slice(0, space) : head.slice(0, MAX_TITLE)).trimEnd()}\u2026`
}

export function ogCardContent(event: OgSource, todayDay: string): OgCardContent {
  const known = event.canonicalCategory && OG_BRAND.categoryColors[event.canonicalCategory]
  const kicker = known ? (event.canonicalCategory as string) : OG_BRAND.fallbackCategory
  const title = clip(clean(event.title))
  const { startDay, endDay } = eventDays(event.dateStart, event.dateEnd)
  const dates = formatDayRange(startDay, endDay, todayDay)
  const place = clean(event.comune?.name ?? '')
  const withPlace = `${dates} \u00b7 ${place}`
  return {
    kicker,
    title,
    // Il comune salta per primo quando la riga non sta (UI-SPEC); senza comune nessun separatore in coda.
    meta: place && withPlace.length <= MAX_META ? withPlace : dates,
    alt: `${title}, ${dates}`,
    bandColor: OG_BRAND.categoryColors[kicker],
  }
}

const PAD = 64
// L'icona della categoria (la stessa del segnaposto del sito) sta a destra:
// il testo cede la sua colonna e il titolo guadagna una riga.
const ICON = 240
const TEXT_W = 1200 - 2 * PAD - ICON - 32

export function OgCard(content: OgCardContent) {
  const b = OG_BRAND
  const { Icon } = categoryVisual(content.kicker)
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: b.canvas,
        fontFamily: b.fontFamily,
        fontWeight: b.fontWeight,
      }}
    >
      <div style={{ display: 'flex', width: 1200, height: b.bandHeight, backgroundColor: content.bandColor }} />
      {/* color sul contenitore: i cerchi pieni di Lucide (fill="currentColor", la tavolozza) Satori li legge dal colore CSS, non dallo stroke. */}
      <div style={{ display: 'flex', position: 'absolute', right: PAD, top: 150, color: content.bandColor }}>
        <Icon size={ICON} color={content.bandColor} strokeWidth={1.5} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: PAD, paddingRight: PAD, marginTop: 48 }}>
        <div style={{ fontSize: 32, lineHeight: 1.2, color: b.inkSecondary }}>{content.kicker}</div>
        <div
          style={{
            // block + lineClamp: l'ellissi' di Satori e' la rete sotto il taglio a 90 caratteri (titoli tutti maiuscoli, colonna stretta).
            display: 'block',
            lineClamp: 4,
            marginTop: 24,
            width: TEXT_W,
            fontSize: 64,
            fontWeight: b.titleWeight,
            lineHeight: 1.1,
            color: b.ink,
          }}
        >
          {content.title}
        </div>
        <div
          style={{
            display: 'block',
            marginTop: 24,
            width: TEXT_W,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            fontSize: 32,
            lineHeight: 1.2,
            color: b.inkSecondary,
          }}
        >
          {content.meta}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          left: PAD,
          right: PAD,
          bottom: PAD,
        }}
      >
        <div style={{ display: 'flex', height: 2, backgroundColor: b.hairline, marginBottom: 24 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 32, lineHeight: 1.2 }}>
          <div style={{ display: 'flex', alignItems: 'center', color: b.ink, fontWeight: b.titleWeight }}>
            {b.logo ? <img src={b.logo} alt="" height={40} style={{ height: 40, marginRight: 16 }} /> : null}
            <div style={{ display: 'flex' }}>{b.wordmark}</div>
          </div>
          <div style={{ display: 'flex', color: b.inkMuted }}>{b.domain}</div>
        </div>
      </div>
    </div>
  )
}

// Self-check: `npx tsx lib/og/card.tsx`, lanciato da scripts/calendar.test.sh
// sotto quattro fusi orari. Scritto prima dell'implementazione e visto rosso
// (TDD). Non chiama OgCard: verifica il testo che Satori riceve, perche' un
// glifo che Satori non ha (emoji, cirillico) gli fa scaricare un font o un
// emoji da un CDN a ogni render (T-20-21).
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failures = 0
  const assertCheck = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`  FAIL: ${msg}`)
      failures++
    }
  }
  const today = '2026-10-16'
  const base: OgSource = {
    title: 'Sagra',
    dateStart: '2027-06-05T00:00:00.000Z',
    dateEnd: '2027-06-05T23:59:59.999Z',
    canonicalCategory: 'Sagre e feste',
    comune: { name: 'Vigolzone' },
  }
  const content = (e: Partial<OgSource>) => ogCardContent({ ...base, ...e }, today)

  // Entita' decodificate, emoji tolte, spazi riuniti.
  const t1 = content({ title: 'Sagra &amp; festa ✨ del tortello \u{1F355}' }).title
  assertCheck(t1 === 'Sagra & festa del tortello', `titolo con entita' ed emoji: "${t1}"`)

  // Solo latino, cifre, punteggiatura e spazi: cirillico e CJK escono.
  const t2 = content({ title: 'Festa Привет 祭り 2027, l’è €5' }).title
  assertCheck(t2 === 'Festa 2027, l’è €5', `titolo con cirillico e CJK: "${t2}"`)
  assertCheck(!/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(t2) && !/\p{Extended_Pictographic}/u.test(t2), 'titolo senza glifi fuori intervallo')

  // Simboli ASCII e grado restano; l'accento decomposto (NFD) si ricompone.
  const t4 = content({ title: 'Rock + Blues 5\u00b0 | A=B <18 ~' }).title
  assertCheck(t4 === 'Rock + Blues 5\u00b0 | A=B <18 ~', `titolo con simboli: "${t4}"`)
  const t5 = content({ title: 'Caffe\u0301 in piazza' }).title
  assertCheck(t5 === 'Caff\u00e9 in piazza', `titolo NFD: "${t5}"`)

  // 150 caratteri: al massimo 91, finisce con "…", taglio su parola intera.
  const words = Array.from({ length: 30 }, (_, i) => `parola${i}`).join(' ')
  const t3 = content({ title: words }).title
  assertCheck(words.length > 140, 'fixture del titolo lungo')
  assertCheck(t3.length <= 91, `titolo lungo: ${t3.length} caratteri (massimo 91)`)
  assertCheck(t3.endsWith('…'), 'titolo lungo finisce con …')
  assertCheck(words.startsWith(t3.slice(0, -1)) && words[t3.length - 1] === ' ', 'il taglio cade su un confine di parola')
  assertCheck(content({ title: 'Titolo breve' }).title === 'Titolo breve', 'titolo breve intatto')

  // Meta: senza comune nessun separatore in coda; troppo lunga, salta il comune.
  const m1 = content({ comune: null }).meta
  assertCheck(m1 === 'sab 5 giu 2027', `meta senza comune: "${m1}"`)
  assertCheck(!m1.endsWith(' · ') && !m1.endsWith('·'), 'meta senza separatore in coda')
  assertCheck(content({}).meta === 'sab 5 giu 2027 · Vigolzone', `meta con comune: "${content({}).meta}"`)
  const long = { dateStart: '2026-12-31T00:00:00.000Z', dateEnd: '2027-01-01T23:59:59.999Z', comune: { name: "Castell'Arquato di Lunga Denominazione" } }
  const m2 = content(long).meta
  assertCheck(m2 === 'gio 31 dic 2026 – ven 1 gen 2027', `meta lunga senza comune: "${m2}"`)
  assertCheck(m2.length <= 50, 'meta lunga entro 50 caratteri')

  // Categoria sconosciuta o assente: "Altro" e banda grigia.
  for (const cat of ['Categoria inventata', null, undefined]) {
    const c = content({ canonicalCategory: cat })
    assertCheck(c.kicker === 'Altro', `categoria ${String(cat)}: kicker "${c.kicker}"`)
    assertCheck(c.bandColor === OG_BRAND.categoryColors.Altro, `categoria ${String(cat)}: banda grigia`)
  }
  assertCheck(content({}).bandColor === OG_BRAND.categoryColors['Sagre e feste'], 'categoria nota: banda della categoria')
  assertCheck(content({}).alt === 'Sagra, sab 5 giu 2027', `alt: "${content({}).alt}"`)

  if (failures > 0) {
    console.error(`[card.tsx] ${failures} controlli falliti`)
    process.exit(1)
  }
  console.log('[card.tsx] self-check OK')
}
