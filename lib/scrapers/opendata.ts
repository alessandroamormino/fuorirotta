/**
 * OpenData Lombardia scraper
 *
 * Fetches JSON from dati.lombardia.it Socrata API with date filtering
 * Queries Socrata API with SoQL date filtering and transforms JSON to Event schema.
 */

import type { ScrapeParams, AdapterResult, ScrapedEvent } from './types'
import { fetchWithRetry } from './utils'

interface OpenDataRecord {
  id?: string
  denom?: string // title
  descriz?: string // description
  data_in?: string // start date
  data_fine?: string // end date
  comune?: string // city
  toponimo?: string // address part 1
  indirizzo?: string // address part 2
  civico?: string // address part 3
  geo_y?: string // latitude
  geo_x?: string // longitude
  tipo?: string // category
  url_programma?: {
    url?: string
  }
}

export async function scrapeOpenData(params: ScrapeParams = {}): Promise<AdapterResult> {
  const startTime = Date.now()

  try {
    // Set default date range (today to 6 months from now)
    const today = new Date()
    const dateFrom = params.dateFrom || today.toISOString().split('T')[0]

    const sixMonthsLater = new Date()
    sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6)
    const dateTo = params.dateTo || sixMonthsLater.toISOString().split('T')[0]

    // Build Socrata API URL with SoQL query
    const whereClause = `data_in>='${dateFrom}' AND data_in<='${dateTo}'`
    const url = `https://www.dati.lombardia.it/resource/hs8z-dcey.json?$limit=2000&$offset=0&$where=${encodeURIComponent(whereClause)}&$order=data_in DESC`

    // Fetch JSON data with retry logic
    const response = await fetchWithRetry(url)
    const data: OpenDataRecord[] = await response.json()

    // Transform to ScrapedEvent format
    const events = transformOpenDataRecords(data)

    const duration = Date.now() - startTime

    return {
      events,
      source: 'opendata_lombardia',
      duration
    }
  } catch (error) {
    const duration = Date.now() - startTime
    return {
      events: [],
      source: 'opendata_lombardia',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export function transformOpenDataRecords(data: OpenDataRecord[]): ScrapedEvent[] {
  const results: ScrapedEvent[] = []

  for (const item of data) {
    if (!item.data_in) continue

    // Parse event dates and normalize to start/end of day
    const eventStartDate = new Date(item.data_in)
    eventStartDate.setHours(0, 0, 0, 0)

    const eventEndDate = item.data_fine ? new Date(item.data_fine) : new Date(eventStartDate)
    eventEndDate.setHours(23, 59, 59, 999)

    // Concatenate address parts (toponimo + indirizzo + civico)
    const address = [
      item.toponimo || '',
      item.indirizzo || '',
      item.civico || ''
    ].join(' ').trim() || null

    // Parse coordinates
    const latitude = item.geo_y ? parseFloat(item.geo_y) : null
    const longitude = item.geo_x ? parseFloat(item.geo_x) : null

    results.push({
      source: 'opendata_lombardia',
      sourceId: item.id || String(Math.random()),
      title: item.denom || 'Evento',
      description: item.descriz || '',
      dateStart: eventStartDate,
      dateEnd: eventEndDate,
      locationName: item.comune || 'Lombardia',
      address,
      latitude,
      longitude,
      category: item.tipo || 'Sagra',
      sourceUrl: item.url_programma?.url || 'https://www.dati.lombardia.it',
      imageUrl: null, // OpenData has no images
      phone: null
    })
  }

  return results
}
