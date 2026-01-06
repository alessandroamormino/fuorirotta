import { Event } from '@prisma/client'

export type { Event }

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
