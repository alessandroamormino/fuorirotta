/**
 * Il punto di scambio della card Open Graph (D-10, D-17).
 *
 * Questo oggetto e' l'unica cosa che il restyling del marchio (piano 20-07)
 * cambia, insieme a OG_VERSION: lib/og/card.tsx legge solo da qui, quindi il
 * restyling cambia valori e non layout. Versione neutra, nello stile attuale
 * del sito.
 *
 * Satori non legge le variabili CSS e il ban dei colori esadecimali (check:tokens)
 * vale fuori da app/globals.css: la palette e' in stringhe rgb(). Le tinte
 * delle categorie sono la copia dei --category-* del tema chiaro; l'autoverifica
 * in fondo le confronta con app/globals.css.
 */

/** Si incrementa a ogni cambio visibile della card: finisce in ?v= e rompe la cache dei crawler. */
export const OG_VERSION = 3

/**
 * Marchio "D2 · F col giro" (concept approvato il 2026-10-17, puo' essere
 * sostituito). Sorgente master: public/brand/marchio.svg; qui sta una copia
 * ritagliata sul disegno (x 52-226, y 16-254; il viewBox parte da 0 0 e lo
 * spostamento sta nel <g>), con i colori in rgb() (niente esadecimali in lib/).
 * Solo tracciati, un cerchio e un anello evenodd: niente maschere, filtri o testo.
 */
const MARK_BLUE = 'rgb(10, 102, 255)'
const MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 174 238" width="174" height="238">' +
  '<g transform="translate(-52 -16)">' +
  `<path fill="none" stroke="${MARK_BLUE}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" d="M80 186 V170 C80 124, 188 92, 188 142 C188 192, 80 172, 80 122 V72 A24 24 0 0 1 104 48 H168"/>` +
  `<path fill="${MARK_BLUE}" fill-rule="evenodd" d="M80 206 A20 20 0 1 1 79.9 206 Z M80 217 A9 9 0 1 0 80.1 217 Z"/>` +
  `<circle cx="202" cy="40" r="16" fill="${MARK_BLUE}"/>` +
  '</g></svg>'

export const OG_BRAND = {
  canvas: 'rgb(255, 255, 255)',
  ink: 'rgb(29, 29, 31)',
  inkSecondary: 'rgb(66, 66, 69)',
  inkMuted: 'rgb(110, 110, 115)',
  hairline: 'rgb(232, 232, 237)',
  bandHeight: 24,
  categoryColors: {
    'Sagre e feste': 'rgb(204, 102, 0)',
    'Musica e spettacolo': 'rgb(175, 82, 222)',
    'Arte e cultura': 'rgb(230, 73, 128)',
    'Fiere e mercati': 'rgb(110, 122, 31)',
    'Sport e outdoor': 'rgb(18, 140, 158)',
    'Food & Wine': 'rgb(142, 59, 70)',
    Altro: 'rgb(110, 110, 115)',
  } as Record<string, string>,
  fallbackCategory: 'Altro',
  fontFamily: 'bricolage',
  /** Bricolage Grotesque: Regular per kicker, meta e dominio; Bold per titolo e wordmark. */
  fontWeight: 400 as 400 | 500 | 600 | 700,
  titleWeight: 700 as 400 | 500 | 600 | 700,
  /** URL o data-URL di un logo da mostrare prima del wordmark. */
  logo: `data:image/svg+xml,${encodeURIComponent(MARK_SVG)}` as string | null,
  wordmark: 'Fuorirotta',
  domain: 'fuori-rotta.it',
}

// Self-check: `npx tsx lib/og/brand.ts`, lanciato da scripts/calendar.test.sh.
// Stesso schema di lib/motion.ts contro app/globals.css (VR-07): le tinte
// delle categorie qui sono la copia dei token CSS del tema chiaro, e una
// copia che diverge in silenzio e' il difetto che questo controllo chiude.
// `require` e' dentro la guardia: il modulo non deve tirare fs fuori da qui.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failures = 0
  const assertCheck = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`  FAIL: ${msg}`)
      failures++
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const css: string = require('fs').readFileSync(require('path').join(__dirname, '../../app/globals.css'), 'utf8')
  const start = css.indexOf(':root')
  const root = css.slice(start, css.indexOf('\n}', start))
  const hexToRgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
  }
  const token = (name: string): string | null => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(root)
    return m ? hexToRgb(m[1]) : null
  }
  const pairs: Array<[string, string]> = [
    ['category-sagre', 'Sagre e feste'],
    ['category-musica', 'Musica e spettacolo'],
    ['category-arte', 'Arte e cultura'],
    ['category-fiere', 'Fiere e mercati'],
    ['category-sport', 'Sport e outdoor'],
    ['category-food', 'Food & Wine'],
    ['muted-foreground', 'Altro'], // --category-altro e' l'alias di --muted-foreground
  ]
  for (const [cssName, category] of pairs) {
    const expected = token(cssName)
    assertCheck(expected !== null, `--${cssName} non trovato nel primo blocco :root`)
    assertCheck(OG_BRAND.categoryColors[category] === expected, `${category}: atteso ${expected} (--${cssName}), trovato ${OG_BRAND.categoryColors[category]}`)
  }
  assertCheck(OG_BRAND.inkMuted === OG_BRAND.categoryColors.Altro, 'inkMuted e il grigio di Altro sono lo stesso --muted-foreground')

  // Ogni categoria canonica ha una tinta (il modulo di tassonomia si carica solo qui).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CANONICAL_CATEGORIES } = require('../categories/taxonomy') as { CANONICAL_CATEGORIES: readonly string[] }
  assertCheck(CANONICAL_CATEGORIES.length === 7, `categorie canoniche: ${CANONICAL_CATEGORIES.length}`)
  for (const name of CANONICAL_CATEGORIES) assertCheck(Boolean(OG_BRAND.categoryColors[name]), `nessuna tinta per "${name}"`)
  assertCheck(Boolean(OG_BRAND.categoryColors[OG_BRAND.fallbackCategory]), 'la categoria di ripiego ha una tinta')

  if (failures > 0) {
    console.error(`[brand.ts] ${failures} controlli falliti`)
    process.exit(1)
  }
  console.log('[brand.ts] self-check OK')
}
