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

export function ogCardContent(event: OgSource, todayDay: string): OgCardContent {
  const known = event.canonicalCategory && OG_BRAND.categoryColors[event.canonicalCategory]
  const kicker = known ? (event.canonicalCategory as string) : OG_BRAND.fallbackCategory
  const title = decodeHtmlEntities(event.title).trim()
  const { startDay, endDay } = eventDays(event.dateStart, event.dateEnd)
  const dates = formatDayRange(startDay, endDay, todayDay)
  const place = decodeHtmlEntities(event.comune?.name ?? '').trim()
  return {
    kicker,
    title,
    meta: place ? `${dates} · ${place}` : dates,
    alt: `${title}, ${dates}`,
    bandColor: OG_BRAND.categoryColors[kicker],
  }
}

const PAD = 64

export function OgCard(content: OgCardContent) {
  const b = OG_BRAND
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
      <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: PAD, paddingRight: PAD, marginTop: 48 }}>
        <div style={{ fontSize: 32, lineHeight: 1.2, color: b.inkSecondary }}>{content.kicker}</div>
        <div
          style={{
            display: 'flex',
            marginTop: 24,
            width: 1200 - 2 * PAD,
            maxHeight: Math.round(64 * 1.1 * 3),
            overflow: 'hidden',
            fontSize: 64,
            lineHeight: 1.1,
            color: b.ink,
          }}
        >
          {content.title}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 24,
            width: 1200 - 2 * PAD,
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
          <div style={{ display: 'flex', alignItems: 'center', color: b.ink }}>
            {b.logo ? <img src={b.logo} alt="" height={40} style={{ height: 40, marginRight: 16 }} /> : null}
            <div style={{ display: 'flex' }}>{b.wordmark}</div>
          </div>
          <div style={{ display: 'flex', color: b.inkMuted }}>{b.domain}</div>
        </div>
      </div>
    </div>
  )
}
