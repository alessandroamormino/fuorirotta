#!/usr/bin/env bash
#
# Esegue un comando contro il Postgres LOCALE di sviluppo, mai contro produzione.
#
# Perche' esiste: .env.local punta al database di produzione e lib/scrapers/env.ts
# lo ricarica con override:true, quindi un semplice "DATABASE_URL=... npm run x"
# puo' essere silenziosamente riportato a produzione. Qui l'URL e' letterale
# (mai letto da un file .env) e viene comunque riasserito prima di eseguire
# qualsiasi cosa, cosi' un errore di configurazione fallisce rumorosamente
# invece di scrivere sul database sbagliato.
#
# Uso: bash scripts/dev-db.sh <comando> [args...]

set -euo pipefail

DEV_DB_URL="postgresql://fuorirotta:fuorirotta@localhost:5433/fuorirotta_dev"

export DATABASE_URL="$DEV_DB_URL"
export DIRECT_URL="$DEV_DB_URL"

# Guardia: se qualcuno cambia DEV_DB_URL puntandolo altrove, si ferma qui.
case "$DATABASE_URL" in
  postgresql://*@localhost:5433/fuorirotta_dev) ;;
  *)
    echo "ABORT: DATABASE_URL non e' il Postgres locale di sviluppo." >&2
    echo "       atteso host localhost:5433, database fuorirotta_dev" >&2
    exit 1
    ;;
esac

if [ "$#" -eq 0 ]; then
  echo "uso: bash scripts/dev-db.sh <comando> [args...]" >&2
  exit 2
fi

exec "$@"
