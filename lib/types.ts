import { Event as PrismaEvent } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'

// Converti Decimal in number per i campi coordinate
export type Event = Omit<
  PrismaEvent,
  'latitude' | 'longitude' | 'resolvedLatitude' | 'resolvedLongitude'
> & {
  latitude: number | null
  longitude: number | null
  resolvedLatitude: number | null
  resolvedLongitude: number | null
  // Fase 12 (card evento, meta "Comune (PR)"): presente solo quando la riga e'
  // agganciata a comuneId/istatCode via include Prisma (app/api/events/route.ts,
  // app/page.tsx). ~1/3 delle righe non ha comuneId (862/2652, Fase 6) e la
  // relazione arriva null: la card cade su locationName, non su un buco.
  comune?: { name: string; provinceCode: string } | null
}

// Filtri di ricerca della Navbar (D-01). comuneId e comuneIstatCode
// coesistono e sono mutuamente sufficienti: il ramo di filtro comune in
// /api/events si attiva se almeno uno dei due e' valorizzato. comuneId e'
// la chiave surrogata di Comune, nota solo dopo una selezione dall'autocomplete
// (app/api/comuni/search); comuneIstatCode e' il codice ISTAT, l'unico che le
// destinazioni suggerite (09-03) possono dichiarare in anticipo, perche' la
// chiave surrogata e' un autoincrement diverso fra locale e produzione.
export interface SearchFilters {
  location: string
  dateFrom: Date | null
  dateTo: Date | null
  radius?: number
  comuneId?: number
  comuneIstatCode?: string
}

export interface EventFilters {
  search?: string
  category?: string
  dateFrom?: string
  dateTo?: string
  lat?: number
  lng?: number
  radius?: number
}

export interface EventsResponse {
  events: Event[]
  total: number
  limit: number
  offset: number
}

export interface Category {
  name: string | null
  count: number
}
