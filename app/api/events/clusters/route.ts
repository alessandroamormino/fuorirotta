import { NextResponse } from 'next/server';
import { getClusterCache } from '@/lib/clusterCache';

export async function GET() {
  try {
    const cache = await getClusterCache();

    if (!cache) {
      return NextResponse.json({
        geojson: null,
        eventCount: 0,
        computedAt: null,
      });
    }

    return NextResponse.json({
      geojson: cache.geojson,
      eventCount: cache.eventCount,
      computedAt: cache.computedAt,
    });
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
