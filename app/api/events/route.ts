import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkCache, createWorkflowExecution, waitForExecution } from '@/lib/cacheService'
import { triggerN8nWorkflow } from '@/lib/n8nClient'

const LOMBARDY_CITIES = [
  'Milano', 'Bergamo', 'Brescia', 'Como', 'Cremona',
  'Lecco', 'Lodi', 'Mantova', 'Monza', 'Pavia',
  'Sondrio', 'Varese'
];

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams

    // Parametri query
    const search = searchParams.get('search') || ''
    const category = searchParams.get('category') || ''
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const lat = searchParams.get('lat')
    const lng = searchParams.get('lng')
    const radius = searchParams.get('radius')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const location = searchParams.get('location') || ''

    // Estrai città dal parametro location
    const cities = parseCitiesFromLocation(location)

    // Build cache query
    const today = new Date().toISOString().split('T')[0]
    const endOfYear = `${new Date().getFullYear()}-12-31`

    const cacheQuery = {
      cities: cities.length > 0 ? cities : undefined,
      radiusKm: radius ? parseInt(radius) : undefined,
      centerLat: lat ? parseFloat(lat) : undefined,
      centerLng: lng ? parseFloat(lng) : undefined,
      dateFrom: dateFrom || today,
      dateTo: dateTo || endOfYear
    }

    // ✅ CACHE CHECK (with fallback if table doesn't exist yet)
    let cacheResult = { isCached: false, isRunning: false, shouldTrigger: false, execution: null }

    try {
      cacheResult = await checkCache(cacheQuery)

      // ✅ TRIGGER n8n se necessario
      if (cacheResult.shouldTrigger) {
        console.log('[Cache] Miss - triggering n8n workflow for query:', cacheQuery)
        const executionId = await createWorkflowExecution(cacheQuery)
        const triggered = await triggerN8nWorkflow(cacheQuery, executionId)

        if (triggered) {
          const completed = await waitForExecution(executionId, 90000)
          if (!completed) {
            console.warn('[n8n] Workflow timeout - returning existing data')
          } else {
            console.log('[n8n] Workflow completed successfully')
          }
        } else {
          console.error('[n8n] Failed to trigger workflow - returning existing data')
        }
      } else if (cacheResult.isRunning) {
        console.log('[Cache] Workflow already running - waiting 5 seconds...')
        await new Promise(resolve => setTimeout(resolve, 5000))
      } else if (cacheResult.isCached && cacheResult.execution) {
        const ageHours = (Date.now() - cacheResult.execution.lastExecutedAt.getTime()) / (1000 * 60 * 60)
        console.log(`[Cache] Hit! Age: ${ageHours.toFixed(1)}h, Events: ${cacheResult.execution.eventCount}`)
      }
    } catch (cacheError: any) {
      // Graceful degradation: if cache table doesn't exist, continue without cache
      if (cacheError?.code === 'P2021' || cacheError?.message?.includes('workflow_executions')) {
        console.warn('[Cache] Table not found - running without cache. Execute migration to enable caching.')
      } else {
        console.error('[Cache] Error:', cacheError)
      }
    }

    // ✅ QUERY DATABASE
    const where: any = {
      dateStart: { gte: dateFrom ? new Date(dateFrom) : new Date() },
    }

    if (dateTo) {
      where.dateStart.lte = new Date(dateTo)
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { locationName: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (category && category !== 'all') {
      where.category = { equals: category, mode: 'insensitive' }
    }

    if (cities.length > 0) {
      where.locationName = { in: cities }
    }

    const events = await prisma.event.findMany({
      where,
      orderBy: { dateStart: 'asc' },
      take: limit,
      skip: offset,
    })

    // ✅ FILTRO RAGGIO (post-query)
    let filteredEvents = events
    if (lat && lng && radius) {
      const userLat = parseFloat(lat)
      const userLng = parseFloat(lng)
      const radiusKm = parseFloat(radius)

      filteredEvents = events.filter((event) => {
        if (!event.latitude || !event.longitude) return false
        const distance = calculateDistance(
          userLat, userLng,
          parseFloat(event.latitude.toString()),
          parseFloat(event.longitude.toString())
        )
        return distance <= radiusKm
      })
    }

    const total = await prisma.event.count({ where })

    return NextResponse.json({
      events: filteredEvents,
      total,
      limit,
      offset,
      cache: {
        hit: cacheResult?.isCached || false,
        age_hours: cacheResult?.execution?.lastExecutedAt
          ? (Date.now() - cacheResult.execution.lastExecutedAt.getTime()) / (1000 * 60 * 60)
          : null
      }
    })
  } catch (error) {
    console.error('[API] Error fetching events:', error)
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
  }
}

function parseCitiesFromLocation(location: string): string[] {
  return LOMBARDY_CITIES.filter(city =>
    location.toLowerCase().includes(city.toLowerCase())
  )
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Raggio Terra in km
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180)
}
