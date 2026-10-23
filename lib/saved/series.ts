/**
 * "Serie" di un evento a piu' date (SAVE-06): tre sorgenti scrivono UNA riga per
 * data e separano la serie dalla data con un '#' nel sourceId. Modulo puro, nessun
 * DOM e nessun Prisma: lo importano il server (findSiblings) e la vista del client
 * (il tipo Sibling), e check:browser-bundle segue anche le righe `import type`.
 *
 *  - altoadige: "{Id}#{From}"; torino: "{id o titolo in minuscolo}#{giorno}".
 *    Si taglia all'ULTIMO '#': un id di torino ricade sul titolo, che puo'
 *    contenere a sua volta un '#'.
 *  - roma: "{slug}#{giorno}#{indirizzo}". Una serie e' lo stesso slug nella
 *    STESSA sede, quindi servono esattamente tre pezzi e il terzo fa da coda.
 *
 * Firenze e Puglia restano fuori (D-17): il loro id porta la data senza un
 * separatore di serie e una regola su titolo e comune rischia falsi abbinamenti.
 * Ogni altra sorgente, o un id senza '#', non ha serie.
 */

export interface SeriesKey {
  /** Inizio del sourceId comune alle date della serie, '#' compreso. */
  prefix: string
  /** Fine del sourceId comune ('' se non ce n'e'). */
  tail: string
}

/** Un'altra data della stessa serie. Qui e non in resolve.ts: lo legge il client (check:browser-bundle). */
export interface Sibling {
  id: number
  dateStart: string
  dateEnd: string | null
}

export function seriesOf(source: string, sourceId: string): SeriesKey | null {
  if (source === 'altoadige' || source === 'torino') {
    const i = sourceId.lastIndexOf('#')
    return i < 0 ? null : { prefix: sourceId.slice(0, i + 1), tail: '' }
  }
  if (source === 'roma') {
    const parts = sourceId.split('#')
    return parts.length === 3 ? { prefix: `${parts[0]}#`, tail: `#${parts[2]}` } : null
  }
  return null
}

// Self-check: `npx tsx lib/saved/series.ts`, lanciato da scripts/saved.test.sh sotto
// quattro fusi orari. La guardia su `typeof` non e' cerimonia: il modulo e'
// raggiungibile da componenti "use client", dove `module` non esiste.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failures = 0
  const eq = (source: string, sourceId: string, want: SeriesKey | null) => {
    const got = seriesOf(source, sourceId)
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      console.error(`  FAIL: ${source} ${sourceId}: atteso ${JSON.stringify(want)}, ottenuto ${JSON.stringify(got)}`)
      failures++
    }
  }
  // H: le fixture non scrivono "#" davanti a cifre, che check:tokens leggerebbe come un colore esadecimale.
  const H = '#'
  eq('altoadige', `A1B2${H}2026-11-01T00:00:00`, { prefix: `A1B2${H}`, tail: '' })
  eq('torino', `festa di ${H}natale${H}2026-12-01`, { prefix: `festa di ${H}natale${H}`, tail: '' })
  // '_' e '%' restano caratteri letterali: la query li lega come parametro di starts_with, mai in un LIKE.
  eq('torino', `sagra_100%${H}2026-11-03`, { prefix: `sagra_100%${H}`, tail: '' })
  eq('roma', `slug${H}2026-11-01${H}via-roma-1`, { prefix: `slug${H}`, tail: `${H}via-roma-1` })
  eq('roma', `slug${H}2026-11-01`, null)
  eq('roma', `a${H}b${H}c${H}d`, null)
  eq('firenze', 'Titolo|2026-11-01', null)
  eq('puglia', '015146:titolo:2026-11-01', null)
  eq('solosagre', `sagra${H}12`, null)
  eq('torino', 'senza-separatore', null)
  if (failures > 0) {
    console.error(`[series.ts] ${failures} verifiche fallite`)
    process.exit(1)
  }
  console.log('[series.ts] self-check OK')
}
