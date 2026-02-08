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
    return NextResponse.json(
      { error: 'Failed to fetch cluster data' },
      { status: 500 }
    );
  }
}
