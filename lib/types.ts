import { Event as PrismaEvent } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'

// Converti Decimal in number per i campi coordinate
export type Event = Omit<PrismaEvent, 'latitude' | 'longitude'> & {
  latitude: number | null
  longitude: number | null
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
