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
export const OG_VERSION = 1

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
  fontFamily: 'geist',
  fontWeight: 400 as 400 | 500 | 600 | 700,
  /** URL o data-URL di un logo da mostrare prima del wordmark; null nella versione neutra. */
  logo: null as string | null,
  wordmark: 'Fuorirotta',
  domain: 'fuori-rotta.it',
}
