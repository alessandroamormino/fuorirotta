import type { Event as PrismaEvent } from '@prisma/client'
import type { Event } from './types'

/**
 * Converte una riga Prisma `Event` in un oggetto semplice, serializzabile.
 *
 * Perche' esiste: i Decimal di Prisma e i Date non attraversano il confine
 * Server -> Client Component ("Only plain objects can be passed to Client
 * Components... Decimal objects are not supported"). La conversione esisteva
 * gia', ma in QUATTRO copie: due route API e due pagine SSR. Quando la Fase 6
 * ha aggiunto `resolvedLatitude`/`resolvedLongitude`, le due copie API sono
 * state aggiornate e le due SSR no — ed e' esattamente il tipo di deriva che
 * quattro copie rendono inevitabile. Una funzione sola: aggiungere una colonna
 * Decimal in futuro e' un punto solo da toccare.
 */
export function serializeEvent(event: PrismaEvent): Event {
  return {
    ...event,
    latitude: decimalToNumber(event.latitude),
    longitude: decimalToNumber(event.longitude),
    resolvedLatitude: decimalToNumber(event.resolvedLatitude),
    resolvedLongitude: decimalToNumber(event.resolvedLongitude),
    dateStart: event.dateStart.toISOString(),
    dateEnd: event.dateEnd?.toISOString() ?? null,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  } as unknown as Event
}

/**
 * `0` e' un valore valido per una coordinata, quindi il test e' sul null/undefined
 * e non sulla verita' del valore: un `event.latitude ? ... : null` scarterebbe
 * silenziosamente lo zero.
 */
function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = parseFloat(String(value))
  return Number.isFinite(n) ? n : null
}
