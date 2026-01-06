import { prisma } from './prisma';
import { generateQueryHash, ScrapeQuery } from './n8nClient';

const CACHE_TTL_HOURS = 4;

interface CacheResult {
  isCached: boolean;
  isRunning: boolean;
  shouldTrigger: boolean;
  execution?: {
    id: number;
    lastExecutedAt: Date;
    status: string;
    eventCount: number;
  };
}

/**
 * Controlla se esiste una cache valida per la query specificata
 * @param query Parametri di ricerca eventi
 * @returns Risultato del check cache con flag per azioni successive
 */
export async function checkCache(query: ScrapeQuery): Promise<CacheResult> {
  const queryHash = generateQueryHash(query);

  const execution = await prisma.workflowExecution.findUnique({
    where: { queryHash }
  });

  // Nessuna esecuzione precedente - trigger necessario
  if (!execution) {
    return { isCached: false, isRunning: false, shouldTrigger: true };
  }

  // Workflow in esecuzione o in coda - aspetta
  if (execution.status === 'running' || execution.status === 'pending') {
    return {
      isCached: false,
      isRunning: true,
      shouldTrigger: false,
      execution: {
        id: execution.id,
        lastExecutedAt: execution.lastExecutedAt,
        status: execution.status,
        eventCount: execution.eventCount
      }
    };
  }

  // Calcola età cache
  const ageInHours = (Date.now() - execution.lastExecutedAt.getTime()) / (1000 * 60 * 60);
  const isFresh = ageInHours < CACHE_TTL_HOURS;

  // Cache valida e fresca
  if (isFresh && execution.status === 'completed') {
    return {
      isCached: true,
      isRunning: false,
      shouldTrigger: false,
      execution: {
        id: execution.id,
        lastExecutedAt: execution.lastExecutedAt,
        status: execution.status,
        eventCount: execution.eventCount
      }
    };
  }

  // Cache scaduta o failed - trigger necessario
  return { isCached: false, isRunning: false, shouldTrigger: true, execution: {
    id: execution.id,
    lastExecutedAt: execution.lastExecutedAt,
    status: execution.status,
    eventCount: execution.eventCount
  } };
}

/**
 * Crea o aggiorna un record di esecuzione workflow nel database
 * @param query Parametri di ricerca eventi
 * @returns ID dell'esecuzione creata/aggiornata
 */
export async function createWorkflowExecution(query: ScrapeQuery): Promise<string> {
  const queryHash = generateQueryHash(query);

  const execution = await prisma.workflowExecution.upsert({
    where: { queryHash },
    update: {
      status: 'pending',
      lastExecutedAt: new Date(),
      errorMessage: null
    },
    create: {
      queryHash,
      location: query.cities?.join(', ') || null,
      radiusKm: query.radiusKm || null,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : null,
      dateTo: query.dateTo ? new Date(query.dateTo) : null,
      cities: query.cities || [],
      status: 'pending',
      lastExecutedAt: new Date()
    }
  });

  return execution.id.toString();
}

/**
 * Aspetta il completamento di un workflow n8n con polling
 * @param executionId ID dell'esecuzione nel database
 * @param maxWaitMs Tempo massimo di attesa in millisecondi (default: 90s)
 * @returns true se completato con successo, false se timeout o fallito
 */
export async function waitForExecution(executionId: string, maxWaitMs: number = 90000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 3000; // Poll ogni 3 secondi

  while (Date.now() - startTime < maxWaitMs) {
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: parseInt(executionId) }
    });

    if (!execution) {
      console.warn(`Workflow execution ${executionId} not found`);
      return false;
    }

    if (execution.status === 'completed') {
      console.log(`Workflow execution ${executionId} completed successfully`);
      return true;
    }

    if (execution.status === 'failed') {
      console.error(`Workflow execution ${executionId} failed: ${execution.errorMessage}`);
      return false;
    }

    // Ancora in pending o running - continua ad aspettare
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.warn(`Workflow execution ${executionId} timed out after ${maxWaitMs}ms`);
  return false; // Timeout - workflow ancora in esecuzione
}
