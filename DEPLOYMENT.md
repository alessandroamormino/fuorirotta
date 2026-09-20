# Fuorirotta Deployment Guide

## Architecture Overview

Fuorirotta is a Next.js 16 full-stack application built with App Router, Prisma ORM, and PostgreSQL. The application discovers and displays events across Lombardy (Italy) by scraping three public data sources and serving them through a map-based UI.

**Tech Stack:**
- Next.js 16 with App Router and TypeScript
- Prisma ORM with PostgreSQL database
- Mapbox for map visualization
- Self-hosted on Hetzner via Docker Compose: a git checkout at `/opt/docker/fuori-rotta/fuorirotta/` runs the `fuorirotta-frontend` container; nginx is itself a container on the same host, reloaded with `docker exec nginx nginx -s reload` (not a system service)

**Scraping Architecture:**

Three event scrapers run as Node.js processes:
1. **SoloSagre** - HTML scraping of Lombardy festivals/sagre (regex-based parsing)
2. **OpenData Lombardia** - Official regional API (dati.lombardia.it/resource/hs8z-dcey.json)
3. **InLombardia** - HTML scraping with AJAX pagination and detail page fetching

Automated scraping is triggered **per region, on a daily staggered schedule** (Phase 14) via a server-side crontab invoking `scripts/cron-scrape.sh <region>`, which POSTs to `/api/cron/scrape?region=<region>`. The unscoped every-4-hours run and the `runAllScrapers()` entry point it used no longer exist: `/api/cron/scrape` requires `?region=` and answers `400` without it, and a per-region lock makes two concurrent runs of the same region return `409`.

**Data Flow:**
```
crontab (daily, one line per region, staggered)
  -> scripts/cron-scrape.sh <region>
  -> POST /api/cron/scrape?region=<region>   (401 no auth / 400 no region / 404 unknown / 409 locked)
  -> runRegion(region)
  -> PostgreSQL

crontab (daily, after the last region)
  -> scripts/cron-maintenance.sh
  -> node:20-alpine container
  -> scripts/maintenance-job.ts   (territorial backfill -> dedup -> cluster cache)
  -> PostgreSQL
  -> /api/events -> Frontend
```

The post-scrape queue (backfill, dedup, cluster cache) was deliberately moved **out** of the scrape path into that daily consolidated job: at twenty regions, running a whole-table pass after every regional scrape would multiply the same work twentyfold.

**Caching Strategy:**

Users receive instant responses (<1s) from cached data. When cache is stale, the API returns cached results immediately while triggering a background refresh — which since Phase 14 refreshes **only the region inferred from the request** (via `comuneId -> Comune.regionName`), under the same lock the cron path uses, and does nothing at all when no region can be inferred. The scheduled per-region cron runs refresh data proactively.

## Prerequisites

- Docker and Docker Compose on the server
- PostgreSQL database (Supabase)
- Mapbox account (for map visualization)
- nginx running as a container on the same host, attached to the external `webstack` network

## Environment Variables

Three categories matter because they are read at different times by different processes — mixing them up is exactly how `CRON_SECRET` went missing from the running container for three months.

| Variable | Category | Description |
|----------|----------|--------------|
| `DIRECT_URL` | Build-only, baked into the image | Direct PostgreSQL connection used by `npx prisma generate` at build time |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Build-only, baked into the image | Public Mapbox token, inlined into the client bundle during `next build` |
| `DATABASE_URL` | Runtime, in the container | PostgreSQL connection URL (with connection pooling if applicable); also passed at build time for `prisma generate` |
| `NEXT_PUBLIC_APP_URL` | Runtime, in the container | App base URL (e.g., `https://fuori-rotta.it`); also passed at build time |
| `CRON_SECRET` | Runtime, in the container | Auth token for `/api/cron/scrape` — generate with `openssl rand -base64 32`. Declared in `docker-compose.yml` as `${CRON_SECRET:?CRON_SECRET must be set in .env}`, so `docker compose up` refuses to start rather than silently running with no secret |
| `HEALTHCHECK_URL` | Host-only, never passed to the container | Dead man's switch URL, read only by `scripts/cron-scrape.sh` on the host. Optional, but its absence is announced on every cron run instead of failing silently |

In production the file is `.env` in the compose directory (`/opt/docker/fuori-rotta/fuorirotta/.env`), not `.env.local` — `.env.local` is a local-development-only convention and is never read by Docker Compose.

**Quoting pitfall:** Docker Compose strips surrounding quotes from values in `.env`, but `source` and ad-hoc shell scripts do not. The same `.env` read two different ways can therefore produce two different values — a secret written as `"abc..."` becomes 44 characters inside the container but 46 characters to a naive reader. `scripts/cron-scrape.sh` strips quotes for exactly this reason. Prefer writing values without quotes in `.env` regardless. The same divergence risk applies to inline comments: Compose strips a trailing `<space>#comment` from a `.env` value (quoted or not); `scripts/cron-scrape.sh` mirrors this, but any other ad-hoc reader of the file may not — avoid inline comments on secret lines when in doubt.

## Local Development

```bash
cp .env.example .env.local
# Fill in environment variables in .env.local
npm install
npx prisma generate
npx prisma db push
npm run dev
```

The development server will start at http://localhost:3000.

**Running scrapers locally:**

```bash
# All scrapers
npm run scrape

# Single scraper
npm run scrape -- inlombardia
npm run scrape -- solosagre
npm run scrape -- opendata

# With custom date range
npm run scrape -- --from 2026-04-01 --to 2026-12-31
```

**Trigger via API:**
```bash
# `?region=` e' obbligatorio dalla Fase 14: senza, la route risponde 400.
curl -X POST "http://localhost:3000/api/cron/scrape?region=lombardia" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Production Deployment (Hetzner, Docker)

### Initial Setup

```bash
git clone <repo> /opt/docker/fuori-rotta/fuorirotta
cd /opt/docker/fuori-rotta/fuorirotta
cp .env.example .env
# Fill in production environment variables in .env (no surrounding quotes)
docker compose up -d --build
```

### nginx Configuration

nginx runs as its own container on the host, attached to the shared external `webstack` network — it is not a system service and is never restarted with `systemctl`. After changing its configuration, reload it with:

```bash
docker exec nginx nginx -s reload
```

```nginx
server {
    listen 80;
    server_name fuori-rotta.it www.fuori-rotta.it;

    location / {
        proxy_pass http://fuorirotta-frontend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }
}
```

### Automated Scraping via Crontab

**Adding a source to an already-scheduled region adds no crontab row.** The schedulable unit is the region, not the source: `trentino-alto-adige` has carried its `5 4 * * *` line since Phase 14, and Phase 19 (`altoadige.ts`) hangs a second source off that same line via `getSourcesByRegion`. For a release like that, skip the "Install it as a BLOCK" procedure below entirely — there is nothing to install — and run only step 4's `--check` to confirm the installed block still matches the registry. Proven by `scripts/crontab-generate.test.sh` S10 (asserts exactly one `trentino-alto-adige` line).

The crontab is no longer a single hand-written line: it is the output of `scripts/generate-crontab.ts`, which reads `REGION_SCHEDULES` from `lib/scrapers/sources.ts` (Phase 14, D-09). Adding a region to the registry means one file to touch; the crontab lines that region needs are regenerated, not hand-edited.

**1. Generate the lines, on the host checkout — NOT inside the container.** The final `runner` stage of the `Dockerfile` copies only `public`, `.next/standalone`, `.next/static`, `node_modules/.prisma` and `prisma/`. It contains neither `scripts/` nor `lib/` nor the devDependencies `tsx` needs to import raw TypeScript, so `docker compose exec … npx tsx scripts/generate-crontab.ts` fails immediately with a missing-file error. This is the same "maintenance scripts live outside the image" rule that `npx prisma migrate deploy` (§Migrations) and `scripts/cron-maintenance.sh` already follow: run it from the same git checkout that `docker compose` itself runs from.

```bash
cd /opt/docker/fuori-rotta/fuorirotta && npx tsx scripts/generate-crontab.ts
```

**Install it as a BLOCK — never replace the whole crontab.** The output is delimited by `# >>> fuorirotta:crontab-generato >>>` and `# <<< fuorirotta:crontab-generato <<<`. Open `crontab -e`, delete any previous fuorirotta lines (before Phase 14 there was a single unscoped `0 */4 * * * … cron-scrape.sh` line), paste the block, and **leave every other line untouched**.

> This host's crontab also carries the certbot renewal for fuori-rotta.it, which copies the new certificate and reloads nginx. An earlier version of this guide said "replace whatever crontab is currently installed" — following it would have deleted that renewal, and the site would have gone dark weeks later when the certificate expired, with nothing pointing at the cause. The generator now owns only what is between its markers; everything outside is none of its business, and `--check` does not even read it.

Example output at the time of writing (all 20 ISTAT regions — SoloSagre generalized nationally, plus Emilia-Romagna and Puglia's own regional sources — plus the consolidated maintenance job; Phase 15, `15-05-PLAN.md`):

```cron
# >>> fuorirotta:crontab-generato >>>
# Generato da scripts/generate-crontab.ts — non modificare a mano.
# ORARI IN UTC: questo host e' su UTC e il suo cron (Vixie 3.0pl1) NON
# supporta CRON_TZ (verificato 2026-09-15). 03:17 UTC = 05:17 in Italia
# d'estate, 04:17 d'inverno.

17 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh lombardia >> /var/log/fuorirotta-cron.log 2>&1
20 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh emilia-romagna >> /var/log/fuorirotta-cron.log 2>&1
23 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh puglia >> /var/log/fuorirotta-cron.log 2>&1
26 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh abruzzo >> /var/log/fuorirotta-cron.log 2>&1
29 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh basilicata >> /var/log/fuorirotta-cron.log 2>&1
32 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh calabria >> /var/log/fuorirotta-cron.log 2>&1
35 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh campania >> /var/log/fuorirotta-cron.log 2>&1
38 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh friuli-venezia-giulia >> /var/log/fuorirotta-cron.log 2>&1
41 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh lazio >> /var/log/fuorirotta-cron.log 2>&1
44 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh liguria >> /var/log/fuorirotta-cron.log 2>&1
47 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh marche >> /var/log/fuorirotta-cron.log 2>&1
50 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh molise >> /var/log/fuorirotta-cron.log 2>&1
53 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh piemonte >> /var/log/fuorirotta-cron.log 2>&1
56 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh sardegna >> /var/log/fuorirotta-cron.log 2>&1
59 3 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh sicilia >> /var/log/fuorirotta-cron.log 2>&1
2 4 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh toscana >> /var/log/fuorirotta-cron.log 2>&1
5 4 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh trentino-alto-adige >> /var/log/fuorirotta-cron.log 2>&1
8 4 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh umbria >> /var/log/fuorirotta-cron.log 2>&1
11 4 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh valle-d-aosta >> /var/log/fuorirotta-cron.log 2>&1
14 4 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh veneto >> /var/log/fuorirotta-cron.log 2>&1
0 11 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-maintenance.sh >> /var/log/fuorirotta-cron.log 2>&1
```

**Why emilia-romagna and puglia can sit only 3 minutes apart from lombardia and from each other, and why the 17 SoloSagre-national lines above cannot use the same reasoning.** `emiliaromagnaturismo.it` and `osservatorio.dms.puglia.it` are each their own host, distinct from `www.solosagre.it`, `www.dati.lombardia.it` and `www.in-lombardia.it` — `groupSourcesByHost` (`lib/scrapers/runner.ts`) already runs different hosts in parallel, so no `Crawl-delay` is at stake for those two; the few minutes of stagger exist only to avoid three scrapes starting on the same DB connection pool at once (D-12), not to be polite to a shared server. **`15-05-PLAN.md`** (`SRC-04`) generalized SoloSagre to all 20 ISTAT regions, and every SoloSagre line — Lombardy plus the 17 new regions above — shares the *same* host, `www.solosagre.it` (`robots.txt` `Crawl-delay: 5`, re-verified live 2026-09-18, unchanged from `08-RESEARCH.md`). Those lines are serialized against each other with a 3-minute gap, sized on the real cost measured with `npm run scrape:local -- --region <slug>` against the local Postgres on 2026-09-18: the highest observed was toscana at 11.7s (29 events, 3 pages) — the 3-minute gap is roughly 15x that, and comfortably covers the theoretical worst case bounded by `SOLOSAGRE_MAX_PAGES=20` (~100–140s, never actually observed). Emilia-Romagna and Puglia's SoloSagre sub-request rides their existing per-region trigger (03:20/03:23) — `REGION_SCHEDULES` is keyed by region, not by source, so no separate schedule entry was needed for those two — and both are already >= 3 minutes from every other SoloSagre line by construction. See the comment above `REGION_SCHEDULES` in `lib/scrapers/sources.ts` for the full measurement log (lombardia, toscana, veneto, lazio, campania, sicilia).

**Turn regions on a few at a time, never all twenty in one deploy.** This crontab block ships in one commit, but that is a code change, not a production activation order. Enable a handful of the new SoloSagre regions at a time (edit the installed crontab block to include only the lines you are turning on this round — the generator's `--check` mode still verifies the full registry matches once everything is live), and after each activation re-run `npm run n1:proof` (on the host, inside the container per its own usage note) to confirm the scrape windows have not started overlapping in practice. Nothing in the schedule *forces* overlap-free behavior beyond the 3-minute gaps above — `n1:proof` is the only thing that checks it against what actually happened, and it costs nothing to run.

**Updating an already-installed block: back up, transform, DIFF, then install behind a guard.** When only a schedule changes there is nothing to paste — but `crontab <file>` replaces the whole crontab with whatever that file contains, *including nothing at all*. On 2026-09-16 a `sed` pipeline broke on a multi-line paste, produced a zero-byte file, and `crontab /tmp/crontab.new` installed it: the certbot renewal was gone, and only `grep -c certbot` returning `0` caught it. The backup made the recovery a single command. Never run `crontab <file>` on a file you have not just diffed, and never on one that has not passed the guard:

```bash
crontab -l > /tmp/crontab.bak                                    # 1. backup FIRST, always
sed 's/^30 5 \(.*cron-maintenance\)/0 9 \1/' /tmp/crontab.bak > /tmp/crontab.new
diff /tmp/crontab.bak /tmp/crontab.new                           # 2. expect exactly the intended lines
grep -q certbot /tmp/crontab.new && [ "$(wc -l < /tmp/crontab.new)" -ge 30 ] && crontab /tmp/crontab.new && echo INSTALLATO || echo "NON installato, controllo fallito"
crontab -l | grep -c certbot                                     # 3. -> 1, never 0
```

Keep every command on ONE line. The failure above came from a `\`-continued command that picked up a newline inside the `sed` expression when pasted into the terminal; `sed` then failed, the redirect had already truncated the output file, and the empty result looked like a successful step. A guard that refuses to install a file without `certbot` in it — or shorter than the crontab is known to be — costs one line and makes that class of accident unreachable.

If the backup is ever lost, the recovery is `crontab -e` and re-pasting: the generated block from `npx tsx scripts/generate-crontab.ts`, plus the certbot renewal, which is not the generator's business and is therefore NOT in its output. That is the reason to take the backup first.

**Schedules are in UTC, and the crontab says so in a comment rather than relying on `CRON_TZ`.** The original design pinned the timezone with a `CRON_TZ=Europe/Rome` line (Assumption A2 of `14-RESEARCH.md`). Verified against this host on 2026-09-15, that assumption is **false**: cron here is `3.0pl1-184ubuntu2` and neither `man 5 crontab` nor `strings /usr/sbin/cron` mentions `CRON_TZ`. Vixie would have parsed the line as an ordinary environment assignment — harmless, but a false promise at the top of a file someone re-reads months later. The host runs UTC, so the schedules are UTC: 03:17 UTC is 05:17 Italian time in summer, 04:17 in winter. This still closes **IN-02** from the Phase 5 code review (the crontab's timezone was never stated before), just by declaring the timezone honestly instead of by a directive this cron ignores.

The host timezone was deliberately left on UTC rather than moved to `Europe/Rome`: the absolute hour does not matter here — what the design requires is that the jobs be daily and **staggered relative to each other**, which holds in any timezone. Changing a host's timezone touches logs, other services and every system cron job: too wide a blast radius for a problem that does not manifest.

**2. Replacing the line is MANDATORY in the same deploy that ships this phase.** Since Phase 14, `/api/cron/scrape` requires `?region=` and answers `400` without it (D-01). A crontab left on the old unscoped line — or simply forgotten during a deploy — does not fail silently: it fails loudly, with a `400` in `/var/log/fuorirotta-cron.log` and a missed dead man's switch ping. That is the intended behavior, not a risk to work around: a scrape that silently stopped running would be far worse than one that visibly errors on every invocation until the crontab is fixed.

**3. The consolidated maintenance job needs a SECOND dead man's switch.** `scripts/cron-maintenance.sh` (territorial backfill + dedup + cluster cache, Phase 14 D-05/D-06) pings `HEALTHCHECK_MAINTENANCE_URL`, read from the host `.env` exactly like `HEALTHCHECK_URL` is — but it is a **distinct** variable, on a **daily** period, because the maintenance job itself runs once a day (unlike the per-region scrape, which may run more or less often depending on `REGION_SCHEDULES`). Configure a second check in whatever dead man's switch service already backs `HEALTHCHECK_URL`, and add `HEALTHCHECK_MAINTENANCE_URL=...` to `.env` on the host.

**4. Detect drift between the registry and what is actually installed.** This is a manual, two-step procedure to run after any deploy that touches the registry — never an `npm test` gate, because it requires a real crontab installed on a real host, unlike every other gate in this project (`scripts/crontab-generate.test.sh` itself is fully self-contained and needs neither):

```bash
# On the host:
crontab -l > /tmp/installed-crontab.txt

# Then, from the same host — on the checkout, not in the container (see step 1):
cd /opt/docker/fuori-rotta/fuorirotta && npx tsx scripts/generate-crontab.ts --check /tmp/installed-crontab.txt
```

Exits `0` and prints `OK: blocco gestito nel crontab combacia col registry` when they match; exits `1` and prints both versions when they diverge. **Only the delimited block is compared** — unrelated crontab entries (certbot, anything else the host runs) are neither read nor reported. If the markers are missing entirely, it says so and prints the block to paste, with the warning not to touch the other lines. A region added to the registry and never scheduled, or a stale line left behind after a region is removed, is exactly the kind of divergence this catches — it must not be able to sit unnoticed for months.

**5. One-time host verification — DONE on 2026-09-15, result negative.** The question was whether this host's cron supports `CRON_TZ`. It does not:

```bash
man 5 crontab | grep -c CRON_TZ       # -> 0
strings /usr/sbin/cron | grep CRON_TZ  # -> no output
timedatectl                            # -> UTC
dpkg -l | grep '^ii  cron '            # -> cron 3.0pl1-184ubuntu2
```

Assumption A2 of `14-RESEARCH.md` is therefore **falsified**, and the generator no longer emits a `CRON_TZ` line. Schedules are UTC and the generated crontab states it in a comment. Re-run these four commands only if the host is rebuilt or its cron package is replaced.

The crontab line still carries no secret — `scripts/cron-scrape.sh` reads `CRON_SECRET` from the same `.env` the container uses, so rotating the secret still means editing exactly one file.

The script exits:
- `0` — the endpoint answered with a 2xx status.
- `1` — the endpoint answered with any other HTTP status (including `000` for a connection failure).
- `2` — configuration error: `.env` is missing, or `CRON_SECRET` / `NEXT_PUBLIC_APP_URL` is absent or empty.

### Deploying Updates

Since 2026-09-20 the image is **built in CI and published to GHCR**; the server no longer
compiles. One command releases, and the same command rolls back.

**Configuration-only change** (rotating `CRON_SECRET`, changing a URL): edit `.env`, then
recreate the container on the image already deployed:

```bash
cd /opt/docker/fuori-rotta/fuorirotta && FUORIROTTA_IMAGE="$(grep -m1 '^image=' .deployed | cut -d= -f2-)" docker compose up -d --no-build
```

**Code release**: GitHub -> Actions -> **Deploy** -> `Run workflow`, and give it the version
(`v2.1.0`, or `sha-33b20e4` for a commit that was never tagged). Or the same thing by hand:

```bash
bash /opt/docker/fuori-rotta/fuorirotta/scripts/deploy.sh v2.1.0
```

`scripts/deploy.sh` is the whole procedure and the only copy of it: pull the image (and stop
there if the registry does not have it, leaving production untouched), align the checkout to the
matching git ref, `prisma generate` + `migrate deploy`, swap the container, then verify —
`/api/monitoring` must answer 200 **and** `/api/events` must return at least one event. If either
check fails it puts the previous image and the previous checkout back and exits non-zero. What is
running is recorded in `.deployed` (image, digest, git sha, timestamp).

**Rollback is not a separate path**: run the same workflow with an earlier version. An emergency
path only ever exercised in emergencies is a path that does not work.

Two things it deliberately does not do:

- **Undo migrations.** They are forward-only. This is why the project's migrations are additive
  (a new nullable column, never a `DROP`): old code keeps working against a newer schema. A
  destructive migration breaks that property and must be released in two separate steps.
- **Run one-off backfills.** They belong to a specific release, not to every release. Declare them
  in the Release notes and run them by hand *before* the swap.

### Images, tags and what a rollback actually needs

`docker tag` does not copy anything — it gives a second **name** to the same bytes on the same
machine. Before 2026-09-20 every rollback image lived only on this VM: one dead disk, or one
`docker image prune -a`, and they were all gone together. Nor is "I can rebuild it" a plan:
rebuilding the same commit does **not** produce the same image, because `npm ci` resolves
packages that move and `node:20-alpine` is a mutable tag. A rollback needs the preserved
artifact, not the recipe — which is what GHCR now holds.

Published tags, all pointing at the same build:

| tag | when | use |
|---|---|---|
| `sha-<short>` | every push to `main` | every commit has a durable artifact |
| `vX.Y.Z` | git tag `v*` | what you release |
| `latest` | git tag `v*` | convenience only — never release by it |

Tags move; a `sha256:` digest does not. `.deployed` records the digest, so "what was running
yesterday at 20:00" has an exact answer.

### Secrets and variables the workflows need

Repository secrets:

| name | used by | what it is |
|---|---|---|
| `DATABASE_URL` | Build | `next build` prerenders the homepage and queries the database |
| `DIRECT_URL` | Build | same, session pooler (port 5432) |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Build | baked into the client bundle — it is public by nature, so restrict it by domain in Mapbox |
| `DEPLOY_SSH_KEY` | Deploy | private key of a key pair authorised on this host |
| `DEPLOY_KNOWN_HOSTS` | Deploy | output of `ssh-keyscan <host>`, so the runner does not trust the first answer it gets |
| `DEPLOY_USER`, `DEPLOY_HOST` | Deploy | where to connect |

Repository variable: `NEXT_PUBLIC_APP_URL` (`https://fuori-rotta.it`).

The build credentials do **not** end up in the published image: `ARG`/`ENV` live only in the
`builder` stage, and `runner` starts again from `FROM base`. `.dockerignore` already excludes
`.env*` and `.git`.

### Tests: two halves, both still in `npm test`

`npm run test:ci` is the 19 gates that need nothing but a checkout — they run on every push in
Actions. `npm run test:local` is the 13 that need the local Postgres, and some of them need a
**real ingested catalogue**: `check:region-coverage` asserts that lombardia, trentino-alto-adige
and lazio are live on real data. On an empty runner those would pass vacuously, which is worse
than not running them, so they stay local. `npm test` is still both halves, in the same order as
before — no gate was dropped, the chain was split in two that do not overlap.

Lint is reported in CI but does **not** fail the job: 47 problems (8 errors) predate this
pipeline. When those are fixed, remove `continue-on-error` from `.github/workflows/ci.yml`.

## Database

### Schema

The database is managed by Prisma. Key models:

- **Event**: Scraped event data with unique constraint on (source, sourceId) to prevent duplicates
- **WorkflowExecution**: Tracks scraper runs (status, duration, event count, completion timestamp)
- **MapClusterCache**: Pre-computed GeoJSON cluster data for instant map rendering

### Migrations

**Production:**
```bash
npx prisma migrate deploy
```

**Development (quick schema sync):**
```bash
npx prisma db push
```

**Generate Prisma Client:**
```bash
npx prisma generate
```

## Monitoring

### API Response Metadata

API responses include cache metadata:

```json
{
  "cache": {
    "fresh": true,
    "age_hours": 2.5,
    "refreshing": false,
    "last_event_count": 1250
  }
}
```

### Scraper Metrics

The cron endpoint returns execution metrics:

```json
{
  "success": true,
  "executionId": "abc123",
  "events": {
    "saved": 45,
    "skipped": 1205,
    "total": 1250
  },
  "clusterCacheUpdated": true
}
```

### Alerting: dead man's switch

`/api/cron/scrape` responds `202` immediately and runs the scrape in the background, so an HTTP 202 only proves the request was accepted — not that the scrape finished. There is deliberately **no internal health endpoint** for this: `GET /api/events` triggers the exact same scrape path on cache staleness (same `cacheQuery`, same `queryHash`, same `WorkflowExecution` row), so any endpoint reading that row would read "healthy" from ordinary site traffic even with the cron completely dead. And no endpoint inside the app can detect the case that actually matters here — the cron never firing at all (crond down, the crontab line deleted, the box rebooted).

Instead, `scripts/cron-scrape.sh` pings an external dead man's switch (`HEALTHCHECK_URL`) only when the scrape POST itself returned 2xx. The monitoring service raises the alarm when a ping doesn't arrive within the expected window — no infrastructure on the box, and it also catches the cron not running at all.

Read the log:
```bash
tail -f /var/log/fuorirotta-cron.log
```

Test the alert channel deliberately (most dead man's switch providers, e.g. healthchecks.io, treat a `/fail` suffix as a manual failure signal) without waiting for a real outage:
```bash
curl -fsS --max-time 10 --retry 3 "$HEALTHCHECK_URL/fail"
```

### Cron health baseline (measured 2026-08-08)

Read from `/var/log/fuorirotta-cron.log`, which the previous crontab line had been appending raw response bodies to since **2026-03-23 20:00 UTC**:

| Response | Count |
|---|---|
| `{"success":true,"message":"Scrape started"}` | 29 |
| `{"error":"Unauthorized"}` | 797 |
| `502 Bad Gateway` (nginx) | 2 |
| **Total** | **828** |

828 responses over ~138 days matches 828 expected invocations at 6/day — so effectively every scheduled invocation is accounted for, and **96.3% of them were rejected**.

The 29 successes are not spread out: ~27 sit at the head of the log (2026-03-23 → ~2026-03-28) and **2 sit at the very tail**, from 2026-08-08 after a `docker compose up -d` finally delivered `CRON_SECRET` into the container. 797 rejections ÷ 6/day = 133 days, which places the breakage at **~2026-03-28** and its end at 2026-08-08 — **4.4 months**, not the 3 months originally estimated from container uptime.

**Why it stayed silent for 4.4 months.** The old line was:

```cron
0 */4 * * * curl -s -X POST "https://fuori-rotta.it/api/cron/scrape" -H "Authorization: Bearer <secret>" >> /var/log/fuorirotta-cron.log 2>&1
```

`curl -s` with no `-f` and no exit-code check: a 401 and a 202 both exit 0 and both append an indistinguishable blob to the log. The log also carries no timestamps, which is why 828 invocations occupy 7 physical lines and the breakage cannot be dated by reading it — only by counting. `scripts/cron-scrape.sh` fixes both: one timestamped line per invocation (`2026-08-08T13:43:38Z cron-scrape http_code=401 FAILED`) and a non-zero exit on any non-2xx.

Treat these numbers as the "before" state. Any future measurement should be read against the post-cutover log, whose format is not comparable to the one above.

## Troubleshooting

### Cron Not Running

**Symptoms:** Scheduled scrapes not executing, or executing but always failing.

**Solutions:**
1. Run the script manually and read its output: `/opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh` — it prints the HTTP code and exits non-zero on failure.
2. Verify the secret actually reaches the container: `docker exec fuorirotta-frontend sh -c 'echo ${#CRON_SECRET}'`. Expect `44` for a secret generated with `openssl rand -base64 32`. `0` means the variable never reached the container (check `.env` and `docker-compose.yml`); `46` means the value still has its surrounding quotes (a script reading `.env` without stripping them).
3. Check cron logs: `tail -f /var/log/fuorirotta-cron.log`
4. Confirm the crontab line still exists and points at the script: `crontab -l`

### Empty Results on First Deploy

**Solutions:**
1. Run initial scrape: `npm run scrape`
2. Or trigger via the script: `/opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh`
3. Verify database connection is working

### Database Connection Errors

**Solutions:**
1. Verify `DATABASE_URL` and `DIRECT_URL` are correct in `.env`
2. Check PostgreSQL is running: `systemctl status postgresql`
3. Verify Prisma client is generated: `npx prisma generate`

### Map Not Loading

**Solutions:**
1. Verify `NEXT_PUBLIC_MAPBOX_TOKEN` is set
2. Check token is valid and has public scope (starts with `pk.`)
3. Ensure token allows requests from your domain

### Slow API Responses

**Solutions:**
1. Check cache is being populated (verify cron is running)
2. Run manual scrape: `npm run scrape`
3. Check database query performance

## Performance Notes

- **InLombardia scraper**: Takes 60-130 seconds for all detail pages
- **Total scrape time**: Typically 2-3 minutes for all three sources combined
- **API response time**: <1 second when serving from cache
- **Cache refresh**: Background refresh is non-blocking (users never wait)
- **Cluster cache**: Pre-computed in cron job for instant map rendering

## Security

- Cron endpoint is protected by `CRON_SECRET` Bearer token
- Database credentials are stored in `.env` in the compose directory (not in code or git); `.env.local` is the local-development-only convention
- The crontab no longer carries any secret — `scripts/cron-scrape.sh` reads it from `.env`, so rotating `CRON_SECRET` means editing one file, not two
- Public Mapbox token is safe to expose (restricted to map rendering only)
- No user authentication required (public event discovery)
