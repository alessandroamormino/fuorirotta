import crypto from 'crypto';

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://192.168.0.130:5678/webhook/fuorirotta-scrape';
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET;

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

/**
 * Triggera il workflow n8n via webhook
 * @param query Parametri di ricerca eventi
 * @param executionId ID dell'esecuzione workflow nel database
 * @returns true se il trigger è riuscito, false altrimenti
 */
export async function triggerN8nWorkflow(query: ScrapeQuery, executionId: string): Promise<boolean> {
  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(N8N_WEBHOOK_SECRET && { 'Authorization': `Bearer ${N8N_WEBHOOK_SECRET}` })
      },
      body: JSON.stringify({
        query: { ...query, query_hash: generateQueryHash(query) },
        execution_id: executionId
      }),
      signal: AbortSignal.timeout(120000) // Timeout 2 minuti
    });

    if (!response.ok) {
      console.error(`n8n webhook returned status ${response.status}: ${response.statusText}`);
      return false;
    }

    return true;
  } catch (error) {
    if (error instanceof Error) {
      console.error('n8n webhook trigger failed:', error.message);
    } else {
      console.error('n8n webhook trigger failed:', error);
    }
    return false;
  }
}
