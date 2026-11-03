/**
 * L'aggancio dati per la notifica "Ci sei stato?" (Fase 28). SOLO server e SOLO LETTURA:
 * qui si sceglie chi dovrebbe riceverla, la Fase 28 la manda. Niente colonna, tabella o
 * flag per "gia' avvisato": "inviato una volta" e' compito di notification_log (Fase 28).
 * Nessuna rotta HTTP: l'unico chiamante e' il job della Fase 28.
 *
 * `savedEndedOn(day)`: per ogni utente, le righe salvate il cui ultimo giorno (Roma) e'
 * `day` ("YYYY-MM-DD") e che l'utente non ha ancora segnato come visitate.
 *
 * L'SQL non puo' replicare la regola di fine giornata di eventDays (due formati di data:
 * 23:59 UTC oppure mezzanotte di Roma), quindi prende un margine di due giorni per lato e
 * il giorno esatto lo decide eventDays in JS, la stessa funzione che usa il resto del sito.
 */
import { eventDays } from '@/lib/eventDays'
import { prisma } from '@/lib/prisma'

export interface EndedSaved {
  userId: string
  /** id della riga salvata (saved_events.id) */
  savedRef: number
  title: string
  source: string
  sourceId: string
}

export async function savedEndedOn(day: string): Promise<EndedSaved[]> {
  const rows = await prisma.$queryRaw<
    Array<{ userId: string; savedRef: number; title: string; source: string; sourceId: string; dateStart: Date; dateEnd: Date | null }>
  >`
    SELECT s.user_id AS "userId", s.id AS "savedRef", s.title, s.source, s.source_id AS "sourceId",
           s.date_start AS "dateStart", s.date_end AS "dateEnd"
    FROM saved_events s
    WHERE COALESCE(s.date_end, s.date_start) >= (${day}::date - 2)
      AND COALESCE(s.date_end, s.date_start) < (${day}::date + 3)
      AND NOT EXISTS (
        SELECT 1 FROM visited_events v
        WHERE v.user_id = s.user_id AND v.source = s.source AND v.source_id = s.source_id
      )
    ORDER BY s.user_id, s.id`
  return rows
    .filter((r) => eventDays(r.dateStart, r.dateEnd).endDay === day)
    .map(({ userId, savedRef, title, source, sourceId }) => ({ userId, savedRef: Number(savedRef), title, source, sourceId }))
}
