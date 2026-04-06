# Fuorirotta Deployment Guide

## Architecture Overview

Fuorirotta is a Next.js 16 full-stack application built with App Router, Prisma ORM, and PostgreSQL. The application discovers and displays events across Lombardy (Italy) by scraping three public data sources and serving them through a map-based UI.

**Tech Stack:**
- Next.js 16 with App Router and TypeScript
- Prisma ORM with PostgreSQL database
- Mapbox for map visualization
- Self-hosted on Hetzner (nginx reverse proxy + PM2)

**Scraping Architecture:**

Three event scrapers run as Node.js processes:
1. **SoloSagre** - HTML scraping of Lombardy festivals/sagre (regex-based parsing)
2. **OpenData Lombardia** - Official regional API (dati.lombardia.it/resource/hs8z-dcey.json)
3. **InLombardia** - HTML scraping with AJAX pagination and detail page fetching

Automated scraping is triggered every 4 hours via a server-side crontab hitting `/api/cron/scrape`.

**Data Flow:**
```
crontab (every 4h)
  -> /api/cron/scrape
  -> runAllScrapers()
  -> PostgreSQL
  -> /api/events
  -> Frontend
```

**Caching Strategy:**

Users receive instant responses (<1s) from cached data. When cache is stale (>4 hours), the API returns cached results immediately while triggering a background refresh. The cron job also refreshes data proactively every 4 hours.

## Prerequisites

- Node.js 20+ on the server
- PostgreSQL database
- Mapbox account (for map visualization)
- nginx as reverse proxy

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| DATABASE_URL | Yes | PostgreSQL connection URL (with connection pooling if applicable) |
| DIRECT_URL | Yes | Direct PostgreSQL connection for Prisma migrations |
| NEXT_PUBLIC_APP_URL | Yes | App base URL (e.g., https://fuorirotta.it) |
| NEXT_PUBLIC_MAPBOX_TOKEN | Yes | Public token for map rendering |
| CRON_SECRET | Yes | Auth token for cron endpoint — generate with `openssl rand -base64 32` |

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

## Production Deployment (Hetzner)

### Initial Setup

```bash
git clone <repo> /var/www/fuorirotta
cd /var/www/fuorirotta
cp .env.example .env.local
# Fill in production environment variables
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
```

### Running with PM2

```bash
npm install -g pm2
pm2 start npm --name fuorirotta -- start
pm2 save
pm2 startup
```

### nginx Configuration

```nginx
server {
    listen 80;
    server_name fuorirotta.it www.fuorirotta.it;

    location / {
        proxy_pass http://localhost:3000;
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

Add to server crontab (`crontab -e`):

```cron
0 */4 * * * curl -s -X GET https://fuorirotta.it/api/cron/scrape \
  -H "Authorization: Bearer YOUR_CRON_SECRET" >> /var/log/fuorirotta-cron.log 2>&1
```

This runs at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC. The endpoint responds immediately with 202 and runs the scrape in the background to avoid timeouts.

### Deploying Updates

```bash
cd /var/www/fuorirotta
git pull
npm install
npx prisma migrate deploy
npm run build
pm2 restart fuorirotta
```

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

### Logs

```bash
# PM2 app logs
pm2 logs fuorirotta

# Cron scrape logs
tail -f /var/log/fuorirotta-cron.log
```

## Troubleshooting

### Cron Not Running

**Symptoms:** Scheduled scrapes not executing

**Solutions:**
1. Verify `CRON_SECRET` is set in `.env.local`
2. Check cron logs: `tail -f /var/log/fuorirotta-cron.log`
3. Test manually: `curl -X GET https://fuorirotta.it/api/cron/scrape -H "Authorization: Bearer YOUR_CRON_SECRET"`

### Empty Results on First Deploy

**Solutions:**
1. Run initial scrape: `npm run scrape`
2. Or trigger via API: `curl -X GET https://fuorirotta.it/api/cron/scrape -H "Authorization: Bearer YOUR_CRON_SECRET"`
3. Verify database connection is working

### Database Connection Errors

**Solutions:**
1. Verify `DATABASE_URL` and `DIRECT_URL` are correct in `.env.local`
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
- Database credentials are stored in `.env.local` (not in code or git)
- Public Mapbox token is safe to expose (restricted to map rendering only)
- No user authentication required (public event discovery)
