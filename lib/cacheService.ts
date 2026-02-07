import { prisma } from './prisma';
import crypto from 'crypto';

const CACHE_TTL_HOURS = 4;

export interface ScrapeQuery {
  cities?: string[];
  radiusKm?: number;
  centerLat?: number;
  centerLng?: number;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Genera un hash SHA-256 deterministico dalla query per il caching
 * Normalizza i parametri per garantire che query equivalenti producano lo stesso hash
 */
export function generateQueryHash(query: ScrapeQuery): string {
  const normalized = {
    cities: (query.cities || []).sort(), // Ordina per consistenza
    radiusKm: query.radiusKm || null,
    centerLat: query.centerLat ? Math.round(query.centerLat * 1000) / 1000 : null, // 3 decimali
    centerLng: query.centerLng ? Math.round(query.centerLng * 1000) / 1000 : null,
    dateFrom: query.dateFrom || '',
    dateTo: query.dateTo || ''
  };

  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

interface CacheResult {
  isCached: boolean;
  isRunning: boolean;
  shouldTrigger: boolean;
  isFresh: boolean;
  ageHours: number | null;
  execution?: {
    id: string;
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
    return { isCached: false, isRunning: false, shouldTrigger: true, isFresh: false, ageHours: null };
  }

  // Workflow in esecuzione o in coda - aspetta
  if (execution.status === 'running' || execution.status === 'pending') {
    const ageInHours = (Date.now() - execution.lastExecutedAt.getTime()) / (1000 * 60 * 60);
    return {
      isCached: false,
      isRunning: true,
      shouldTrigger: false,
      isFresh: false,
      ageHours: ageInHours,
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
      isFresh: true,
      ageHours: ageInHours,
      execution: {
        id: execution.id,
        lastExecutedAt: execution.lastExecutedAt,
        status: execution.status,
        eventCount: execution.eventCount
      }
    };
  }

  // Cache scaduta o failed - trigger necessario
  return {
    isCached: false,
    isRunning: false,
    shouldTrigger: true,
    isFresh: false,
    ageHours: ageInHours,
    execution: {
      id: execution.id,
      lastExecutedAt: execution.lastExecutedAt,
      status: execution.status,
      eventCount: execution.eventCount
    }
  };
}

/**
 * Crea o aggiorna un record di esecuzione workflow nel database
 * @param query Parametri di ricerca eventi
 * @param eventCount Optional: number of events found (if provided, status set to 'completed')
 * @returns ID dell'esecuzione creata/aggiornata
 */
export async function createWorkflowExecution(query: ScrapeQuery, eventCount?: number): Promise<string> {
  const queryHash = generateQueryHash(query);
  const executionId = `scraper_${Date.now()}`;

  const execution = await prisma.workflowExecution.upsert({
    where: { queryHash },
    update: {
      status: eventCount !== undefined ? 'completed' : 'pending',
      lastExecutedAt: new Date(),
      eventCount: eventCount !== undefined ? eventCount : undefined,
      errorMessage: null
    },
    create: {
      id: executionId,
      queryHash,
      location: query.cities?.join(', ') || null,
      radiusKm: query.radiusKm || null,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : null,
      dateTo: query.dateTo ? new Date(query.dateTo) : null,
      cities: query.cities || [],
      status: eventCount !== undefined ? 'completed' : 'pending',
      eventCount: eventCount !== undefined ? eventCount : 0,
      lastExecutedAt: new Date()
    }
  });

  return execution.id;
}

/**
 * Completa l'esecuzione di un workflow con successo
 * @param executionId ID dell'esecuzione workflow
 * @param eventCount Numero di eventi trovati
 */
export async function completeWorkflowExecution(executionId: string, eventCount: number): Promise<void> {
  try {
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: 'completed',
        eventCount,
        lastExecutedAt: new Date(),
        errorMessage: null
      }
    });
  } catch (error) {
    console.error(`[Cache] Failed to complete workflow execution ${executionId}:`, error);
  }
}

/**
 * Marca l'esecuzione di un workflow come fallita
 * @param executionId ID dell'esecuzione workflow
 * @param errorMessage Messaggio di errore
 */
export async function failWorkflowExecution(executionId: string, errorMessage: string): Promise<void> {
  try {
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: {
        status: 'failed',
        errorMessage
      }
    });
  } catch (error) {
    console.error(`[Cache] Failed to mark workflow execution ${executionId} as failed:`, error);
  }
}

