/**
 * Resa visiva delle 7 categorie canoniche (D-05/D-10, Fase 12).
 *
 * Fonte unica: CANONICAL_CATEGORIES di lib/categories/taxonomy.ts (Fase 11).
 * Non e' una lista da reinventare — il record qui sotto e' tipizzato su
 * CanonicalCategory apposta, cosi' un ottavo nome canonico futuro rompe il
 * type-check invece di scivolare a runtime.
 *
 * Il colore e' esposto come NOME DI TOKEN, mai come esadecimale
 * (npm run check:tokens vieta hex fuori da app/globals.css). Chi rende in
 * JSX lo consuma come style={{ color: "var(--category-sagre)" }} costruito
 * dal nome; chi rende su canvas Mapbox lo legge a runtime con
 * getComputedStyle, come gia' fa readThemeColors() in EventsMap.tsx.
 *
 * Modulo puro: nessun accesso al DOM, sicuro nel bundle client e server —
 * consumato sia da componenti (StatusBadge/CategoryPlaceholder) sia,
 * a partire dal piano 12-03, dai pin della mappa.
 */
import { PartyPopper, Music, Palette, Store, Activity, Wine, Tag, type LucideIcon } from 'lucide-react'
import { CANONICAL_CATEGORIES, FALLBACK_CATEGORY, type CanonicalCategory } from './taxonomy'

export interface CategoryVisual {
  token: string
  Icon: LucideIcon
}

export const CATEGORY_VISUALS: Record<CanonicalCategory, CategoryVisual> = {
  'Sagre e feste': { token: '--category-sagre', Icon: PartyPopper },
  'Musica e spettacolo': { token: '--category-musica', Icon: Music },
  'Arte e cultura': { token: '--category-arte', Icon: Palette },
  'Fiere e mercati': { token: '--category-fiere', Icon: Store },
  'Sport e outdoor': { token: '--category-sport', Icon: Activity },
  'Food & Wine': { token: '--category-food', Icon: Wine },
  Altro: { token: '--category-altro', Icon: Tag },
}

/**
 * Risolve una qualunque stringa di categoria sulla sua resa visiva. Cade
 * sempre su Altro invece di restituire undefined: il segnaposto non deve
 * mai renderizzare vuoto per un valore sconosciuto/legacy.
 */
export function categoryVisual(name: string): CategoryVisual {
  return (CANONICAL_CATEGORIES as readonly string[]).includes(name)
    ? CATEGORY_VISUALS[name as CanonicalCategory]
    : CATEGORY_VISUALS[FALLBACK_CATEGORY]
}
