import { NextRequest, NextResponse } from 'next/server';
import { runAllScrapers } from '@/lib/scrapers';
import {
  createWorkflowExecution,
  completeWorkflowExecution,
  failWorkflowExecution
} from '@/lib/cacheService';
import { updateClusterCache } from '@/lib/clusterCache';

// Vercel Pro allows up to 60s for serverless functions
export const maxDuration = 60;

/**
 * Validate CRON_SECRET from request headers
 *
 * Checks Authorization header for "Bearer <CRON_SECRET>"
 * This is the standard Vercel Cron authentication pattern
 *
 * @param request - NextRequest object
 * @returns true if valid, false otherwise
 */
function validateCronSecret(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;

  // Deny by default if CRON_SECRET not configured
  if (!cronSecret) {
    console.warn('[Cron] CRON_SECRET not configured - denying request');
    return false;
  }

  // Check Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    console.warn('[Cron] Missing Authorization header');
    return false;
  }

  // Extract token from "Bearer <token>" format
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (token !== cronSecret) {
    console.warn('[Cron] Invalid CRON_SECRET');
    return false;
  }

  return true;
}

/**
 * Execute scraping with WorkflowExecution tracking
 */
async function executeScrape() {
  const today = new Date().toISOString().split('T')[0];
  const endOfYear = `${new Date().getFullYear()}-12-31`;

  // Create cacheQuery for tracking
  const cacheQuery = {
    dateFrom: today,
    dateTo: endOfYear
  };

  console.log('[Cron] Starting scheduled scrape...');

  // Create execution tracking record
  const executionId = await createWorkflowExecution(cacheQuery);
  console.log(`[Cron] Created execution ${executionId}`);

  try {
    // Run all scrapers
    const result = await runAllScrapers({ dateFrom: today, dateTo: endOfYear });

    // Mark execution as complete
    await completeWorkflowExecution(executionId, result.saved);

    // Update map cluster cache with new event data
    try {
      await updateClusterCache();
      console.log('[Cron] Cluster cache updated');
    } catch (clusterError) {
      console.error('[Cron] Failed to update cluster cache:', clusterError);
      // Non-fatal: map will fall back to computing from events
    }

    console.log('[Cron] Scrape completed successfully');

    return {
      success: true,
      message: 'Cron scrape completed',
      executionId,
      events: {
        saved: result.saved,
        skipped: result.skipped,
        total: result.total,
      },
      clusterCacheUpdated: true,
      errors: result.errors.length > 0 ? result.errors : undefined
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Cron] Scrape failed:', errorMsg);

    // Mark execution as failed
    await failWorkflowExecution(executionId, errorMsg);

    throw error;
  }
}

/**
 * GET handler for Vercel Cron (Vercel Cron uses GET by default)
 */
export async function GET(request: NextRequest) {
  // Validate CRON_SECRET
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fire-and-forget: respond immediately to avoid nginx 504 timeout.
  // Scraping can take several minutes; the result is tracked via WorkflowExecution.
  executeScrape().catch(err =>
    console.error('[Cron] Background scrape failed:', err)
  );

  return NextResponse.json({ success: true, message: 'Scrape started' }, { status: 202 });
}

/**
 * POST handler for manual cron triggers
 */
export async function POST(request: NextRequest) {
  // Validate CRON_SECRET
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fire-and-forget: respond immediately to avoid nginx 504 timeout.
  // Scraping can take several minutes; the result is tracked via WorkflowExecution.
  executeScrape().catch(err =>
    console.error('[Cron] Background scrape failed:', err)
  );

  return NextResponse.json({ success: true, message: 'Scrape started' }, { status: 202 });
}
