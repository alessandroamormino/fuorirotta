import { NextRequest, NextResponse } from 'next/server';
import { runAllScrapers } from '@/lib/scrapers';

/**
 * Manual scrape trigger endpoint
 *
 * POST /api/scrape
 *
 * Optional body:
 * {
 *   "dateFrom": "2026-01-01",  // Optional: Start date YYYY-MM-DD, defaults to today
 *   "dateTo": "2026-12-31"     // Optional: End date YYYY-MM-DD, defaults to end of year
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Parse body with fallback for empty body
    const body = await request.json().catch(() => ({}));

    // Set defaults
    const today = new Date().toISOString().split('T')[0];
    const endOfYear = `${new Date().getFullYear()}-12-31`;

    const dateFrom = body.dateFrom || today;
    const dateTo = body.dateTo || endOfYear;

    console.log('[Scrape API] Starting manual scrape:', { dateFrom, dateTo });

    // Run all scrapers (saves events to DB internally)
    await runAllScrapers({ dateFrom, dateTo });

    console.log('[Scrape API] Scrape completed successfully');

    return NextResponse.json({
      success: true,
      message: 'Scrape completed successfully',
      params: { dateFrom, dateTo }
    });
  } catch (error) {
    console.error('[Scrape API]', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for usage documentation
 */
export async function GET() {
  return NextResponse.json({
    message: 'Manual scrape trigger endpoint',
    usage: {
      method: 'POST',
      body: {
        dateFrom: 'string (optional) - Start date YYYY-MM-DD, defaults to today',
        dateTo: 'string (optional) - End date YYYY-MM-DD, defaults to end of year'
      }
    }
  });
}
