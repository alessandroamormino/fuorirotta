import { prisma } from './prisma';
import type { Event as PrismaEvent } from '@prisma/client';
import { composeEvent, groupMembersByCanonical } from './dedup/compose';

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
  //
  // DEDUP-01: canonicalEventId: null, altrimenti un duplicato certo resta
  // visibile come due pin sovrapposti sulla stessa mappa (senza questo
  // filtro, updateClusterCache() richiamata in coda al passo di dedup
  // ricalcolerebbe comunque la cache sulle righe membro).
  const events = await prisma.event.findMany({
    where: {
      dateStart: { gte: today },
      resolvedLatitude: { not: null },
      resolvedLongitude: { not: null },
      canonicalEventId: null,
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
      source: true,
    },
    orderBy: { dateStart: 'asc' },
  });

  // DEDUP-04: componi title/locationName/category/imageUrl con lo stesso
  // schema a due query gia' usato da /api/events (una query membri per il
  // lotto, mai una per riga) — cosi' il popup della mappa e la scheda
  // dell'evento non possono mai mostrare un valore diverso per lo stesso
  // evento fuso. Il cast e' verso i soli campi selezionati sopra: composeEvent
  // legge solo COMPOSABLE_FIELDS + source/id, tutti presenti in questa select.
  let composedEvents = events;
  if (events.length > 0) {
    const canonicalIds = events.map((e) => e.id);
    const members = await prisma.event.findMany({
      where: { canonicalEventId: { in: canonicalIds } },
      select: {
        id: true,
        canonicalEventId: true,
        title: true,
        locationName: true,
        category: true,
        imageUrl: true,
        source: true,
      },
      orderBy: { id: 'asc' },
    });
    const membersByCanonical = groupMembersByCanonical(
      members as unknown as PrismaEvent[]
    );
    composedEvents = events.map(
      (e) =>
        composeEvent(
          e as unknown as PrismaEvent,
          membersByCanonical.get(e.id) ?? []
        ) as unknown as typeof e
    );
  }

  return {
    type: 'FeatureCollection',
    features: composedEvents.map(event => ({
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
