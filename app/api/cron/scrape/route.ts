import { NextRequest, NextResponse } from 'next/server';
import { runRegion, getRegions, getSourcesByRegion } from '@/lib/scrapers';
import {
  createWorkflowExecution,
  completeWorkflowExecution,
  failWorkflowExecution
} from '@/lib/cacheService';
import { acquireRegionLock, releaseRegionLock } from '@/lib/scrapers/regionLock';

/**
 * Validate CRON_SECRET from request headers
 *
 * Checks Authorization header for "Bearer <CRON_SECRET>"
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
 * Execute scraping with WorkflowExecution tracking, scoped a una regione (D-01, SCHED-01).
 */
async function executeScrape(region: string) {
  const today = new Date().toISOString().split('T')[0];
  const endOfYear = `${new Date().getFullYear()}-12-31`;

  // La regione entra nel cacheQuery (campo `cities`) perche' generateQueryHash
  // (lib/cacheService.ts) normalizza SOLO {cities, radiusKm, centerLat,
  // centerLng, dateFrom, dateTo} e createWorkflowExecution fa upsert su
  // quello stesso hash: senza la regione qui, due regioni triggerate lo
  // stesso giorno condividerebbero una sola riga WorkflowExecution e si
  // sovrascriverebbero lo stato a vicenda (RESEARCH Pitfall 2).
  const cacheQuery = {
    dateFrom: today,
    dateTo: endOfYear,
    cities: [region]
  };

  console.log(`[Cron] Starting scheduled scrape for region "${region}"...`);

  // Il finally avvolge l'INTERO corpo (createWorkflowExecution incluso), non
  // solo il ramo runRegion: il rilascio deve avvenire anche se la creazione
  // della riga WorkflowExecution stessa fallisse, non solo su un fallimento
  // dello scrape (D-13, plan 14-02 Task 2).
  try {
    // Create execution tracking record
    const executionId = await createWorkflowExecution(cacheQuery);
    console.log(`[Cron] Created execution ${executionId}`);

    try {
      // Run scrapers scoped to this region only
      const result = await runRegion(region, { dateFrom: today, dateTo: endOfYear });

      // Mark execution as complete
      await completeWorkflowExecution(executionId, result.saved);

      console.log(`[Cron] Scrape completed successfully for region "${region}"`);

      // La cache dei cluster NON viene piu' ricalcolata qui (D-07, 14-03):
      // e' l'ultimo passo del job consolidato giornaliero
      // (scripts/maintenance-job.ts), dopo backfill territoriale e dedup —
      // ricalcolarla anche a ogni scrape la mostrerebbe aggiornata prima
      // che backfill/dedup abbiano risolto comune e duplicati.
      return {
        success: true,
        message: 'Cron scrape completed',
        executionId,
        region,
        events: {
          saved: result.saved,
          skipped: result.skipped,
          total: result.total,
        },
        errors: result.errors.length > 0 ? result.errors : undefined
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Cron] Scrape failed for region "${region}":`, errorMsg);

      // Mark execution as failed
      await failWorkflowExecution(executionId, errorMsg);

      throw error;
    }
  } finally {
    // Best-effort (releaseRegionLock inghiotte i propri errori): la scadenza
    // ripara comunque entro LOCK_TTL_MS se questo rilascio non arrivasse mai.
    await releaseRegionLock(region);
  }
}

/**
 * Handler condiviso da GET e POST (erano identici): valida il segreto,
 * DOPO valida la regione (l'ordine e' parte del contratto — l'autenticazione
 * precede sempre la validazione della regione, non-regressione Fase 5),
 * poi avvia lo scrape fire-and-forget.
 */
async function handleCronTrigger(request: NextRequest): Promise<NextResponse> {
  // Validate CRON_SECRET PRIMA di qualunque altra cosa
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const region = request.nextUrl.searchParams.get('region')?.trim();

  // Assente o vuota -> 400 immediato, nessun fire-and-forget (D-01)
  if (!region) {
    return NextResponse.json(
      { error: 'Parametro "region" obbligatorio' },
      { status: 400 }
    );
  }

  // Regione sconosciuta al registry -> 404 immediato con l'elenco (D-03)
  if (getSourcesByRegion(region).length === 0) {
    return NextResponse.json(
      { error: `Regione sconosciuta: "${region}"`, availableRegions: getRegions() },
      { status: 404 }
    );
  }

  // Unica acquisizione SINCRONA della route (D-13, SCHED-03): se uno scrape
  // e' gia' in corso per questa regione, 409 immediato e nessuno scrape parte.
  // Il rilascio avviene dentro executeScrape (finally), non qui.
  if (!(await acquireRegionLock(region))) {
    return NextResponse.json(
      { error: `Scrape gia' in corso per la regione "${region}"` },
      { status: 409 }
    );
  }

  // Fire-and-forget: respond immediately to avoid nginx 504 timeout.
  // Scraping can take several minutes; the result is tracked via WorkflowExecution.
  executeScrape(region).catch(err =>
    console.error('[Cron] Background scrape failed:', err)
  );

  return NextResponse.json({ success: true, message: 'Scrape started', region }, { status: 202 });
}

/**
 * GET handler for cron triggers (called by server-side crontab)
 */
export async function GET(request: NextRequest) {
  return handleCronTrigger(request);
}

/**
 * POST handler for manual cron triggers
 */
export async function POST(request: NextRequest) {
  return handleCronTrigger(request);
}
