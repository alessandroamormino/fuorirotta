// Chiavi e etichette dei follow (Fase 23). Modulo puro e sicuro nel bundle del
// browser: importa solo due liste dichiarative, nessun database, nessun Node.
// Un follow e' una coppia (kind, key): comune = codice ISTAT, provincia =
// sigla, regione = slug di events.region, categoria = nome canonico.
import { VALID_REGION_SLUGS } from '../scrapers/regionSlug'
import { CANONICAL_CATEGORIES } from '../categories/taxonomy'

export const FOLLOW_KINDS = ['comune', 'province', 'region', 'category'] as const
export type FollowKind = (typeof FOLLOW_KINDS)[number]
export type PlaceKind = Exclude<FollowKind, 'category'>
export type FollowItem = { kind: FollowKind; key: string; label: string }

/** Tetto dei luoghi seguiti per account (D-04): le categorie non contano. */
export const PLACE_CAP = 50
export const STALE_COMUNE_CHIP = 'Comune non più disponibile'

/**
 * Porta d'ingresso della chiave: solo la FORMA, mai l'esistenza (quella la
 * controlla il server con il database). Insieme chiuso per le regioni e le
 * categorie, regex per ISTAT (6 cifre) e sigle (2 maiuscole).
 */
export function isWellFormed(kind: string, key: string): kind is FollowKind {
  switch (kind) {
    case 'comune':
      return /^\d{6}$/.test(key)
    case 'province':
      return /^[A-Z]{2}$/.test(key)
    case 'region':
      return VALID_REGION_SLUGS.has(key)
    case 'category':
      return (CANONICAL_CATEGORIES as readonly string[]).includes(key)
    default:
      return false
  }
}

export function isPlaceKind(kind: string): kind is PlaceKind {
  return kind === 'comune' || kind === 'province' || kind === 'region'
}

export const followId = (kind: FollowKind, key: string): string => `${kind}:${key}`

export const regionChip = (name: string): string => name
export const provinceChip = (provinceName: string): string => `Provincia di ${provinceName}`
export const comuneChip = (name: string, provinceCode: string): string => `${name} (${provinceCode})`

/** Nome dentro una frase: "Provincia di Bergamo" -> "provincia di Bergamo", gli altri invariati. */
export const noticeName = (chip: string): string => (chip.startsWith('Provincia di ') ? `p${chip.slice(1)}` : chip)

const KIND_ORDER: Record<FollowKind, number> = { region: 0, province: 1, comune: 2, category: 3 }

/** Regioni, province, comuni (alfabetico italiano), poi le categorie nell'ordine della tassonomia. */
export function sortFollows<T extends FollowItem>(list: readonly T[]): T[] {
  const categoryRank = (key: string) => (CANONICAL_CATEGORIES as readonly string[]).indexOf(key)
  return [...list].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.kind === 'category' ? categoryRank(a.key) - categoryRank(b.key) : a.label.localeCompare(b.label, 'it')) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  )
}
