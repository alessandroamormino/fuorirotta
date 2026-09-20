/**
 * Categoria dedotta dal TITOLO, per le sorgenti che non dichiarano una
 * categoria propria.
 *
 * Spostato qui dall'adattatore Alto Adige (dove era nato con D-11) il
 * 2026-09-20, senza cambiare una riga della logica: serviva a una seconda
 * sorgente (Comune di Firenze, il cui GeoJSON non ha alcun campo categoria) e
 * la regola e' italiano generico, non altoatesino — la parte specifica di
 * quella sorgente sono i TAG, che restano in `deriveAltoAdigeCategory`.
 *
 * Il rifattore e' protetto dal gate gia' esistente: `npm run check:altoadige`
 * S3 misura la quota di eventi fuori da 'Altro' sulla fixture (76,82%, soglia
 * 70%) e cade se questo file cambia esito.
 *
 * Restituisce un nome canonico o null; `canonicalizeCategory` risolve il null
 * in 'Altro' senza lanciare. Nessun accesso al database: funzione pura.
 */

export const TITLE_CATEGORY_FAMILIES: Array<{ category: string; keywords: string[] }> = [
  {
    category: 'Fiere e mercati',
    keywords: ['mercatino', 'mercato', 'markt', 'fiera', 'mostra mercato']
  },
  {
    category: 'Food & Wine',
    keywords: [
      'castagna',
      'keschtn',
      'torggelen', // normalizzato senza dieresi, copre anche "Törggelen"
      'vino',
      'wein',
      'degustazione',
      'gusto',
      'oktoberfest',
      'brunch',
      'graukase' // normalizzato senza dieresi, copre anche "Graukäse"
    ]
  },
  {
    category: 'Sport e outdoor',
    keywords: [
      'corsa',
      'run',
      'marathon',
      'skimarathon',
      'granfondo',
      'marcia',
      'trail',
      'escursione',
      "tiro con l'arco",
      'sci',
      'snowboard',
      'coppa del mondo',
      'triathlon',
      'bici',
      'rally',
      'hike',
      'gara',
      'gran premio'
    ]
  },
  {
    category: 'Musica e spettacolo',
    // 'concert' e non 'concerto': stem che copre "concerto", "concerti",
    // "concertistica". Stesso criterio di 'visit' in Arte e cultura.
    // Il secondo blocco e' stato aggiunto il 2026-09-20 con la sorgente
    // Firenze: parole italiane generiche, non fiorentine, che mancavano
    // perche' le famiglie erano nate sul vocabolario altoatesino (Torggelen,
    // sci). Senza, restavano fuori titoli come "Italian Opera", "Concerti
    // d'Opera", "Mozart & Rossini", "Film in lingua originale".
    keywords: [
      'concert', 'musica', 'festival', 'brass', 'coro', 'teatro', 'cabaret', 'band', 'magia', 'gala',
      'opera', 'orchestra', 'sinfon', 'lirica', 'jazz', 'cinema', 'film', 'danza', 'balletto',
      'spettacolo', 'recital', 'rassegna musicale', 'concertistica', 'arie e duetti', 'concertino'
    ]
  },
  {
    category: 'Sagre e feste',
    keywords: [
      'festa',
      'sagra',
      'fest',
      'kirchtag',
      'krampus',
      'carnevale',
      'avvento',
      'natale',
      'transumanza',
      'desmontegada',
      "rientro dall'alpeggio",
      'ognissanti'
    ]
  },
  {
    category: 'Arte e cultura',
    // "visit" (non "visita"): stem che copre sia "visita" sia "visite"
    // (es. "Visite serali alla Torre Bianca"), senza inventare una forma
    // plurale separata.
    keywords: [
      'mostra', 'museo', 'visit', 'tour guidato', 'conferenza', 'seminario', 'anniversario', 'planetario',
      // Aggiunte con la sorgente Firenze (2026-09-20), stesso criterio: nomi
      // comuni italiani, non specifici di una citta'.
      'esposizione', 'pittur', 'scultur', 'poeta', 'poesia', 'libro', 'lettura', 'biblioteca',
      'archeolog', 'restauro', 'incontro con', 'presentazione del'
    ]
  }
]

// Minuscole + rimozione diacritici (D-11: "senza distinzione di accenti dove
// serve"): "Törggelen"/"Keschtnigl-Sunntig" matchano le stesse parole chiave
// scritte senza dieresi/accento.
export function normalizeForMatching(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function categoryFromTitle(title: string): string | null {
  if (!title) return null
  const normalized = normalizeForMatching(title)
  for (const family of TITLE_CATEGORY_FAMILIES) {
    for (const keyword of family.keywords) {
      if (normalized.includes(normalizeForMatching(keyword))) {
        return family.category
      }
    }
  }
  return null
}
