/**
 * Evento canonico + membri + composeEvent per le route che servono un evento
 * a un client anonimo (.ics, e in seguito la card OG). Solo server: importa
 * Prisma e la composizione della dedup.
 *
 * Stessa lettura di app/eventi/[id]/page.tsx (getEvent): comune con la sola
 * select name/provinceCode, mai la riga intera.
 */
import type { Event as PrismaEvent } from '@/lib/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { composeEvent } from '@/lib/dedup/compose'

export type ComposedEvent = PrismaEvent & { comune: { name: string; provinceCode: string } | null }

export type ComposedEventResult =
  | { status: 'not-found' }
  | { status: 'member'; canonicalId: number }
  | { status: 'ok'; event: ComposedEvent }

export async function getComposedEvent(id: number): Promise<ComposedEventResult> {
  const row = await prisma.event.findUnique({
    where: { id },
    include: { comune: { select: { name: true, provinceCode: true } } },
  })
  if (!row) return { status: 'not-found' }
  // D-15: una riga membro non ha pagina propria, rimanda alla canonica.
  if (row.canonicalEventId !== null) return { status: 'member', canonicalId: row.canonicalEventId }
  const members = await prisma.event.findMany({
    where: { canonicalEventId: row.id },
    orderBy: { id: 'asc' },
  })
  // composeEvent copia la riga canonica ({ ...canonical }): `comune` resta.
  return { status: 'ok', event: composeEvent(row, members) as ComposedEvent }
}

/** URL assoluto della pagina evento: stessa catena di ripiego di BASE_URL in app/eventi/[id]/page.tsx. */
export function canonicalEventUrl(id: number): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'https://fuori-rotta.it').replace(/\/$/, '')
  return `${base}/eventi/${id}`
}
