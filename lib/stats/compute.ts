import { CANONICAL_CATEGORIES } from '../categories/taxonomy'
import { eventDays } from '../eventDays'

/**
 * Statistiche di /account e di Profilo: UN calcolo, due linguaggi (Fase 27.1, D-12).
 * Questo modulo e' la fonte unica dei numeri; ios/Packages/FuorirottaCore/.../Stats.swift
 * ne e' la copia fedele. La fixture Fixtures/stats.json si genera da qui
 * (scripts/ios-stats.ts --write): check:ios-stats (CI) e swift test StatsParityTests
 * fanno fallire chi cambia un lato da solo.
 *
 * Modulo puro: nessun DOM, nessuna API solo-Node (importabile da componenti client).
 */

/** Un evento oltre questi giorni di calendario (estremi inclusi) accende solo il giorno d'inizio (UI-SPEC, A13). */
export const HEATMAP_MAX_SPREAD_DAYS = 14

export type StatItem = { dateStart: string; dateEnd: string | null; category: string | null }
export type VisitedStatItem = { visitDay: string; category: string | null }
export type Stats = {
  days: Record<string, number>
  perMonth: number[]
  perCategory: Array<[string, number]>
  years: number[]
}

const yearOf = (day: string) => Number(day.slice(0, 4))
const monthOf = (day: string) => Number(day.slice(5, 7))

function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** I giorni che un evento salvato accende: tutti, fino a 14; oltre, solo il primo. */
function countedDays(item: StatItem, maxSpread: number): string[] {
  const { startDay, endDay } = eventDays(item.dateStart, item.dateEnd)
  const out: string[] = []
  for (let cursor = startDay; cursor <= endDay && out.length <= maxSpread; cursor = nextDay(cursor)) {
    out.push(cursor)
  }
  return out.length > maxSpread ? [startDay] : out
}

const categoryName = (c: string | null) =>
  c !== null && (CANONICAL_CATEGORIES as readonly string[]).includes(c) ? c : 'Altro'

/** Per conteggio decrescente, a pari conteggio nell'ordine della tassonomia. */
function sortCategories(counts: Map<string, number>): Array<[string, number]> {
  const order = (n: string) => (CANONICAL_CATEGORIES as readonly string[]).indexOf(n)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || order(a[0]) - order(b[0]))
}

/** Salvati: ogni evento accende i suoi giorni; il mese e la categoria contano una volta per evento. */
// maxSpread esiste solo perche' scripts/ios-stats.ts (E2) provi che un tetto sbagliato viene rilevato.
export function computeStats(items: StatItem[], year: number, maxSpread = HEATMAP_MAX_SPREAD_DAYS): Stats {
  const days: Record<string, number> = {}
  const perMonth = Array<number>(12).fill(0)
  const perCategory = new Map<string, number>()
  const years = new Set<number>()
  for (const item of items) {
    const counted = countedDays(item, maxSpread)
    counted.forEach((d) => years.add(yearOf(d)))
    const inYear = counted.filter((d) => yearOf(d) === year)
    if (inYear.length === 0) continue
    inYear.forEach((d) => (days[d] = (days[d] ?? 0) + 1))
    new Set(inYear.map(monthOf)).forEach((m) => perMonth[m - 1]++)
    const name = categoryName(item.category)
    perCategory.set(name, (perCategory.get(name) ?? 0) + 1)
  }
  return { days, perMonth, perCategory: sortCategories(perCategory), years: [...years].sort((a, b) => a - b) }
}

/** Visitati (D-05): una cella per evento, nel suo giorno di visita salvato. */
export function computeVisitedStats(items: VisitedStatItem[], year: number): Stats {
  const days: Record<string, number> = {}
  const perMonth = Array<number>(12).fill(0)
  const perCategory = new Map<string, number>()
  const years = new Set<number>()
  for (const item of items) {
    years.add(yearOf(item.visitDay))
    if (yearOf(item.visitDay) !== year) continue
    days[item.visitDay] = (days[item.visitDay] ?? 0) + 1
    perMonth[monthOf(item.visitDay) - 1]++
    const name = categoryName(item.category)
    perCategory.set(name, (perCategory.get(name) ?? 0) + 1)
  }
  return { days, perMonth, perCategory: sortCategories(perCategory), years: [...years].sort((a, b) => a - b) }
}

/** Le tre tessere (D-09, D-11). year null = "Sempre". */
export function statsTiles(
  visited: VisitedStatItem[],
  saved: StatItem[],
  year: number | null
): { daysOut: number; visited: number; saved: number } {
  if (year === null) {
    return { daysOut: new Set(visited.map((v) => v.visitDay)).size, visited: visited.length, saved: saved.length }
  }
  const inYear = visited.filter((v) => yearOf(v.visitDay) === year)
  return {
    daysOut: new Set(inYear.map((v) => v.visitDay)).size,
    visited: inYear.length,
    saved: computeStats(saved, year).perCategory.reduce((sum, [, n]) => sum + n, 0)
  }
}

/** Anno corrente se ha dati, altrimenti l'ultimo; null senza dati. */
export function defaultStatsYear(years: number[], currentYear: number): number | null {
  return years.includes(currentYear) ? currentYear : (years[years.length - 1] ?? null)
}
