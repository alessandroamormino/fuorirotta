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

Automated scraping is triggered every 4 hours via a server-side crontab invoking `scripts/cron-scrape.sh`, which POSTs to `/api/cron/scrape`.

**Data Flow:**
```
crontab (every 4h)
  -> scripts/cron-scrape.sh
  -> POST /api/cron/scrape
  -> runAllScrapers()
  -> PostgreSQL
  -> /api/events
  -> Frontend
```

**Caching Strategy:**

Users receive instant responses (<1s) from cached data. When cache is stale (>4 hours), the API returns cached results immediately while triggering a background refresh. The cron job also refreshes data proactively every 4 hours.

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
curl -X POST http://localhost:3000/api/cron/scrape \
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

Add to the server crontab (`crontab -e`):

```cron
0 */4 * * * /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh >> /var/log/fuorirotta-cron.log 2>&1
```

This runs at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC. Note that **the crontab line no longer carries any secret** — `scripts/cron-scrape.sh` reads `CRON_SECRET` from the same `.env` the container uses. This closes off the failure mode where the token in the crontab and the token in `.env` silently drift apart: rotating the secret now means editing exactly one file.

The script exits:
- `0` — the endpoint answered with a 2xx status.
- `1` — the endpoint answered with any other HTTP status (including `000` for a connection failure).
- `2` — configuration error: `.env` is missing, or `CRON_SECRET` / `NEXT_PUBLIC_APP_URL` is absent or empty.

### Deploying Updates

Two distinct procedures, because they carry very different risk: recreating a container with new configuration is routine, rebuilding the image ships every commit accumulated since the last build.

**Configuration-only change** (e.g. rotating `CRON_SECRET`, updating a URL): edit `.env`, then recreate the container on the current image:

```bash
cd /opt/docker/fuori-rotta/fuorirotta
docker compose up -d
```

**Code release** (deploying new commits): pull and rebuild the image:

```bash
cd /opt/docker/fuori-rotta/fuorirotta
git pull
docker compose up -d --build
```

Tag the current image before rebuilding if you may need a fast rollback — once a build replaces it, the old image becomes dangling and can be removed by a routine `docker image prune`, leaving no quick way back.

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
