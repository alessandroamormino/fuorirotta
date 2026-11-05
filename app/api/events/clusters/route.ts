import { NextResponse } from 'next/server';
import { getClusterCache, getClusterComputedAt } from '@/lib/clusterCache';

export async function GET(request: Request) {
  try {
    // ETag = istante di calcolo della cache: se l'app ha gia' il file, un 304
    // le costa un header invece di 2,5 MB, e la colonna geojson non si legge.
    const computedAt = await getClusterComputedAt();
    const etag = computedAt ? `"${computedAt.toISOString()}"` : null;
    const ifNoneMatch = request.headers.get('if-none-match')?.replace(/^W\//, '');
    if (etag && ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }

    const cache = await getClusterCache();

    if (!cache) {
      return NextResponse.json({
        geojson: null,
        eventCount: 0,
        computedAt: null,
      });
    }

    return NextResponse.json(
      {
        geojson: cache.geojson,
        eventCount: cache.eventCount,
        computedAt: cache.computedAt,
      },
      // L'ETag torna dalla riga letta ora (non da quella del primo giro): se la
      // cache cambia tra le due letture il client riceve comunque un ETag coerente.
      { headers: { ETag: `"${cache.computedAt.toISOString()}"` } },
    );
  } catch (error) {
    console.error('[API] Error fetching cluster cache:', error);
    // Return empty cache instead of 500 to allow app to function without cluster data
    return NextResponse.json({
      geojson: null,
      eventCount: 0,
      computedAt: null,
    });
  }
}
