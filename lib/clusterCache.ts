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
  today.setHours(0, 0, 0, 0);

  const events = await prisma.event.findMany({
    where: {
      dateStart: { gte: today },
      latitude: { not: null },
      longitude: { not: null },
    },
    select: {
      id: true,
      title: true,
      dateStart: true,
      locationName: true,
      category: true,
      imageUrl: true,
      latitude: true,
      longitude: true,
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
          parseFloat(event.longitude!.toString()),
          parseFloat(event.latitude!.toString()),
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
