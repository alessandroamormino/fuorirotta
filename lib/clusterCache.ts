import { prisma } from './prisma';

interface ClusterCacheData {
  geojson: GeoJSON.FeatureCollection;
  eventCount: number;
  computedAt: Date;
}

/**
 * Compute GeoJSON FeatureCollection from all future events with coordinates.
 * This is the data Mapbox needs for client-side clustering.
 */
export async function computeClusterData(): Promise<GeoJSON.FeatureCollection> {
  const today = new Date();
  // UTC, non ora locale del processo: il Postgres locale gira in UTC (vedi
  // docker-compose.dev.yml) e la verifica TERR-07 confronta questo conteggio
  // con `date_trunc('day', now())`, che usa il timezone di sessione del DB.
  // Con setHours() (ora locale) il confine "oggi" si sfasa di 1-2h rispetto
  // al DB a seconda dell'ora legale, includendo/escludendo eventi diversi
  // vicino a mezzanotte — bug scoperto eseguendo la verifica del piano 06-01
  // contro dati reali (2269 vs 2249 eventi).
  today.setUTCHours(0, 0, 0, 0);

  // Il punto usato dalla mappa e' quello materializzato dal backfill territoriale
  // (resolvedLatitude/resolvedLongitude), non le colonne di sorgente: include il
  // centroide del comune per gli eventi senza coordinate proprie (D-09/D-14,
  // Fase 6). latitude/longitude restano lette dal backfill ma non da qui.
  const events = await prisma.event.findMany({
    where: {
      dateStart: { gte: today },
      resolvedLatitude: { not: null },
      resolvedLongitude: { not: null },
    },
    select: {
      id: true,
      title: true,
      dateStart: true,
      locationName: true,
      category: true,
      imageUrl: true,
      resolvedLatitude: true,
      resolvedLongitude: true,
    },
    orderBy: { dateStart: 'asc' },
  });

  return {
    type: 'FeatureCollection',
    features: events.map(event => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [
          parseFloat(event.resolvedLongitude!.toString()),
          parseFloat(event.resolvedLatitude!.toString()),
        ],
      },
      properties: {
        id: event.id,
        title: event.title,
        dateStart: event.dateStart.toISOString(),
        locationName: event.locationName || '',
        category: event.category || '',
        imageUrl: event.imageUrl || '',
      },
    })),
  };
}

/**
 * Store pre-computed cluster data in database
 */
export async function updateClusterCache(): Promise<void> {
  const geojson = await computeClusterData();

  await prisma.mapClusterCache.upsert({
    where: { id: 'default' },
    update: {
      geojson: geojson as any,
      eventCount: geojson.features.length,
      computedAt: new Date(),
    },
    create: {
      id: 'default',
      geojson: geojson as any,
      eventCount: geojson.features.length,
      computedAt: new Date(),
    },
  });

  console.log(`[ClusterCache] Updated with ${geojson.features.length} events`);
}

/**
 * Retrieve pre-computed cluster data from database
 */
export async function getClusterCache(): Promise<ClusterCacheData | null> {
  const cache = await prisma.mapClusterCache.findUnique({
    where: { id: 'default' },
  });

  if (!cache) return null;

  return {
    geojson: cache.geojson as unknown as GeoJSON.FeatureCollection,
    eventCount: cache.eventCount,
    computedAt: cache.computedAt,
  };
}
