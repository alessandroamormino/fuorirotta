import { prisma } from './prisma';
import type { Event as PrismaEvent } from '@prisma/client';
import { composeEvent, groupMembersByCanonical } from './dedup/compose';
import { romeMidnightUTC, todayInRome } from './dateWindow';

interface ClusterCacheData {
  geojson: GeoJSON.FeatureCollection;
  eventCount: number;
  computedAt: Date;
}

/**
 * GeoJSON dei pin della mappa: gli eventi DISPONIBILI (in corso o futuri) con
 * coordinate risolte. E' cio' che Mapbox raggruppa lato client.
 *
 * 2026-09-20: prima erano i soli `dateStart >= oggi`, e la mappa mostrava
 * quindi MENO eventi della lista — /api/events usa la semantica di overlap
 * dal bugfix del 2026-09-10, quindi una mostra aperta fino a dicembre era in
 * lista ma senza pin. Misurato sul Postgres locale: 18.769 pin contro 19.291
 * eventi disponibili con coordinate. Stessa finestra e stesso confine di
 * /api/events e di lib/coverage/liveRegions.ts: una regola sola.
 */
export async function computeClusterData(): Promise<GeoJSON.FeatureCollection> {
  // Mezzanotte di OGGI a Roma come istante UTC, non `setUTCHours(0,0,0,0)`:
  // le colonne sono `@db.Timestamp(6)` e portano mezzanotte LOCALE scritta
  // come cifre UTC, quindi il confine UTC sbagliava di 1-2 ore secondo l'ora
  // legale (lib/dateWindow.ts spiega la misura che lo ha dimostrato). Il
  // vecchio commento qui giustificava l'UTC con l'allineamento alla verifica
  // TERR-07 di scripts/territorial-backfill.test.sh: era la verifica a dover
  // seguire il prodotto, non il contrario, ed ora legge il confine da qui.
  const windowStart = romeMidnightUTC(todayInRome());

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
      // COALESCE(dateEnd, dateStart) >= windowStart, scritto come OR esplicito
      // perche' Prisma non ha COALESCE nei filtri e dateEnd e' nullable.
      OR: [
        { dateEnd: { gte: windowStart } },
        { AND: [{ dateEnd: null }, { dateStart: { gte: windowStart } }] },
      ],
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
      canonicalCategory: true,
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
    // Fase 11: il popup della mappa (non filtrata) pubblica il nome canonico,
    // non la colonna grezza — cosi' popup filtrato e non filtrato nominano la
    // stessa categoria per lo stesso evento. canonicalCategory NON e' composta
    // (vedi commento in lib/dedup/compose.ts sopra COMPOSABLE_FIELDS): si legge
    // sempre dalla riga canonica, mai da un membro fuso.
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
        category: event.canonicalCategory || '',
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
