#!/usr/bin/env -S npx tsx
/**
 * Stato di RLS visto dall'utente che l'app usa davvero (SOLA LETTURA).
 *
 * Perche' esiste invece di una query incollata a mano: il SQL Editor del
 * dashboard Supabase gira come un utente diverso da quello della
 * DATABASE_URL, quindi risponderebbe alla domanda sbagliata. E perche' il
 * terminale dell'host rovina le stringhe lunghe incollate (2026-09-16:
 * un sed spezzato a meta' ha azzerato il crontab, certbot compreso).
 *
 * Uso, sull'host, dentro node:20-alpine col checkout montato — l'engine
 * Prisma in node_modules e' compilato per musl:
 *   docker run --rm -v $PWD:/app -w /app -e DATABASE_URL="$DB" node:20-alpine npx --yes tsx scripts/rls-check.ts
 */
import { prisma } from '../lib/prisma'

async function main() {
  const [identity] = await prisma.$queryRawUnsafe<
    { current_user: string; bypassa_rls: boolean | null }[]
  >(
    "SELECT current_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassa_rls"
  )

  console.log(`utente dell'app: ${identity.current_user}`)
  console.log(`bypassa RLS:     ${identity.bypassa_rls}`)
  console.log(
    identity.bypassa_rls
      ? "-> togliere le policy permissive NON chiude fuori l'app"
      : "-> ATTENZIONE: l'app passa DALLE policy, non toglierle senza sostituirle"
  )

  const policies = await prisma.$queryRawUnsafe<
    { tablename: string; policyname: string; cmd: string; roles: string; qual: string | null }[]
  >(
    "SELECT tablename, policyname, cmd, roles::text AS roles, qual FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname"
  )

  console.log(`\npolicy nello schema public: ${policies.length}`)
  for (const p of policies) {
    console.log(`  ${p.tablename}.${p.policyname}  cmd=${p.cmd}  roles=${p.roles}  using=${p.qual ?? '-'}`)
  }

  const rls = await prisma.$queryRawUnsafe<{ tablename: string; rowsecurity: boolean }[]>(
    "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true ORDER BY tablename"
  )
  console.log(`\ntabelle con RLS attivo: ${rls.map(r => r.tablename).join(', ') || 'nessuna'}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
