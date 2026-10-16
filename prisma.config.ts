// Configurazione della CLI di Prisma (7+): schema, migrazioni e URL.
//
// Prisma 7 non legge piu' .env da solo: lo carica dotenv qui. Le variabili
// gia' presenti nell'ambiente vincono (scripts/dev-db.sh esporta quelle del
// Postgres locale, e restano quelle).
//
// La CLI usa DIRECT_URL, mai DATABASE_URL: in produzione DATABASE_URL e' il
// pooler di Supabase in transaction mode (porta 6543), che rompe DDL e
// advisory lock delle migrazioni; DIRECT_URL e' la 5432 dello stesso host.
// Vuoto e non un errore quando manca: `prisma generate` (postinstall, CI,
// build Docker) non apre connessioni e non deve pretenderla.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? "",
  },
});
