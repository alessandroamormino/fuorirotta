/**
 * Istantanea di un evento salvato: cio' che /salvati mostra quando la riga
 * sorgente e' stata cancellata dal purge dei 7 giorni (D1). La costruisce
 * SEMPRE il server dalla riga viva, mai un client con testo suo: i titoli
 * arrivano da siti di terzi e finirebbero in una tabella e in un file .ics.
 *
 * Modulo puro: nessun DOM, nessun React, nessun Prisma. Importato da componenti
 * "use client" (store, lista), quindi sicuro nel bundle browser. Anche per
 * questo `ResolvedItem` vive qui e non in resolve.ts: check:browser-bundle
 * segue pure le righe `import type`, e un file client che importa un tipo da un
 * modulo che importa lib/prisma fallisce il gate.
 */

/**
 * Per quanto un evento finito resta in "Passati" (D-01). E' il numero che
 * /privacy dichiara: la lista sul dispositivo e il purge lato server lo
 * condividono, cosi' non possono divergere dal testo.
 */
export const SAVED_RETENTION_MONTHS = 12

export interface Snap {
  title: string
  /** ISO 8601, le stesse cifre della colonna: eventDays() legge entrambi i formati. */
  dateStart: string
  dateEnd: string | null
  place: string | null
  category: string
  source: string
  sourceId: string
  sourceUrl: string | null
}

/** Una riga della risposta di POST /api/v1/saved/resolve, una per id richiesto. */
export interface ResolvedItem {
  /** L'id richiesto, cosi' il client riconosce la risposta anche se l'ordine cambiasse. */
  ref: number
  /** canonicalEventId ?? id della riga viva, null se la riga non esiste piu'. */
  eventId: number | null
  live: Snap | null
}

interface SnapSource {
  title: string
  dateStart: Date | string
  dateEnd?: Date | string | null
  locationName?: string | null
  comune?: { name: string; provinceCode: string } | null
  canonicalCategory: string
  source: string
  sourceId: string
  sourceUrl?: string | null
}

const iso = (d: Date | string): string => new Date(d).toISOString()

export function snapFromEvent(e: SnapSource): Snap {
  // Stessa regola del segmento luogo di EventCard: comune "Nome (PR)", poi il luogo scritto dalla sorgente.
  const location = (e.locationName ?? '').trim()
  const place = e.comune ? `${e.comune.name} (${e.comune.provinceCode})` : location || null
  return {
    title: e.title,
    dateStart: iso(e.dateStart),
    dateEnd: e.dateEnd == null ? null : iso(e.dateEnd),
    place,
    category: e.canonicalCategory,
    source: e.source,
    sourceId: e.sourceId,
    // Solo http(s), come calendarFields: un "javascript:" non deve finire in un link.
    sourceUrl: e.sourceUrl && /^https?:\/\//i.test(e.sourceUrl) ? e.sourceUrl : null,
  }
}

// Self-check: `npx tsx lib/saved/snapshot.ts`, lanciato da scripts/saved.test.sh
// sotto quattro fusi orari. La guardia su `typeof` non e' cerimonia: il modulo
// e' raggiungibile da componenti "use client" e nel bundle browser `module`
// non esiste (check:browser-bundle).
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failures = 0
  const assertCheck = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`  FAIL: ${msg}`)
      failures++
    }
  }
  const base = {
    title: 'Sagra',
    dateStart: '2026-10-18T00:00:00.000Z',
    canonicalCategory: 'Sagra',
    source: 'x',
    sourceId: '1',
  }

  assertCheck(
    snapFromEvent({ ...base, comune: { name: 'Bergamo', provinceCode: 'BG' }, locationName: 'Piazza' }).place === 'Bergamo (BG)',
    'il comune vince sul luogo'
  )
  assertCheck(snapFromEvent({ ...base, locationName: '  Piazza Vecchia ' }).place === 'Piazza Vecchia', 'senza comune vale il luogo, tagliato')
  assertCheck(snapFromEvent({ ...base, locationName: '   ' }).place === null, 'luogo vuoto -> null')
  assertCheck(snapFromEvent(base).place === null, 'nessun luogo -> null')
  assertCheck(snapFromEvent({ ...base, sourceUrl: 'javascript:alert(1)' }).sourceUrl === null, 'sourceUrl javascript: scartato')
  assertCheck(snapFromEvent({ ...base, sourceUrl: 'HTTPS://example.it/e' }).sourceUrl === 'HTTPS://example.it/e', 'sourceUrl https tenuto')
  const a = snapFromEvent({ ...base, dateEnd: '2026-10-19T23:59:59.999Z' })
  const b = snapFromEvent({ ...base, dateStart: new Date(base.dateStart), dateEnd: new Date('2026-10-19T23:59:59.999Z') })
  assertCheck(a.dateStart === b.dateStart && a.dateEnd === b.dateEnd, 'Date e stringa danno le stesse stringhe ISO')
  assertCheck(a.dateStart === '2026-10-18T00:00:00.000Z' && snapFromEvent(base).dateEnd === null, 'ISO invariato, fine nulla resta nulla')

  if (failures > 0) {
    console.error(`[snapshot.ts] ${failures} verifiche fallite`)
    process.exit(1)
  }
  console.log('[snapshot.ts] self-check OK')
}
