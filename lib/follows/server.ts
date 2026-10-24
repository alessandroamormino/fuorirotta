// Etichette e lista dei follow, solo lato server (Fase 23). Le etichette le
// costruisce sempre il server da comuni, elenco province e mappa delle regioni:
// il client non detta mai il testo che poi viene mostrato (T-23-03).
import { getProvinceDirectory } from '@/lib/coverage/liveRegions'
import { prisma } from '@/lib/prisma'
import { VALID_REGION_SLUGS } from '@/lib/scrapers/regionSlug'
import {
  STALE_COMUNE_CHIP,
  comuneChip,
  provinceChip,
  regionChip,
  sortFollows,
  type FollowItem,
  type FollowKind,
} from '@/lib/follows/keys'

/** Etichetta di una chiave gia' ben formata; null = comune o provincia che non esistono. */
export async function resolveFollowLabel(kind: FollowKind, key: string): Promise<string | null> {
  switch (kind) {
    case 'region':
      return regionChip(VALID_REGION_SLUGS.get(key) ?? key)
    case 'category':
      return key
    case 'province': {
      const p = (await getProvinceDirectory()).find((r) => r.provinceCode === key)
      return p ? provinceChip(p.provinceName) : null
    }
    case 'comune': {
      const c = await prisma.comune.findUnique({ where: { istatCode: key }, select: { name: true, provinceCode: true } })
      return c ? comuneChip(c.name, c.provinceCode) : null
    }
  }
}

/** Lista dell'utente con le etichette: tre letture in tutto, niente N+1. */
export async function listFollows(userId: string): Promise<{ onboarded: boolean; follows: FollowItem[] }> {
  const [rows, pref] = await Promise.all([
    prisma.userFollow.findMany({ where: { userId }, select: { kind: true, key: true } }),
    prisma.userPreference.findUnique({ where: { userId }, select: { onboardedAt: true } }),
  ])
  const comuneKeys = rows.filter((r) => r.kind === 'comune').map((r) => r.key)
  const hasProvinces = rows.some((r) => r.kind === 'province')
  const [comuni, provinces] = await Promise.all([
    comuneKeys.length
      ? prisma.comune.findMany({ where: { istatCode: { in: comuneKeys } }, select: { istatCode: true, name: true, provinceCode: true } })
      : [],
    hasProvinces ? getProvinceDirectory() : [],
  ])
  const comuneLabel = new Map(comuni.map((c) => [c.istatCode, comuneChip(c.name, c.provinceCode)]))
  const provinceLabel = new Map(provinces.map((p) => [p.provinceCode, provinceChip(p.provinceName)]))

  const follows: FollowItem[] = []
  for (const r of rows) {
    const kind = r.kind as FollowKind
    let label: string | undefined
    if (kind === 'comune') label = comuneLabel.get(r.key) ?? STALE_COMUNE_CHIP
    else if (kind === 'province') label = provinceLabel.get(r.key) ?? r.key // ponytail: raw code if a province leaves the directory by law
    else if (kind === 'region') label = regionChip(VALID_REGION_SLUGS.get(r.key) ?? r.key)
    else if (kind === 'category') label = r.key
    if (label !== undefined) follows.push({ kind, key: r.key, label })
  }
  return { onboarded: pref?.onboardedAt != null, follows: sortFollows(follows) }
}
