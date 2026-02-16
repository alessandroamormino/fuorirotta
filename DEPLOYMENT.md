# Fuorirotta Deployment Guide

## Architecture Overview

Fuorirotta is a Next.js 16 full-stack application built with App Router, Prisma ORM, and PostgreSQL. The application discovers and displays events across Lombardy (Italy) by scraping three public data sources and serving them through a map-based UI.

**Tech Stack:**
- Next.js 16 with App Router and TypeScript
- Prisma ORM with PostgreSQL database (Supabase)
- Mapbox for map visualization
- Vercel for hosting and serverless functions

**Scraping Architecture:**

Three event scrapers run natively in Node.js as Vercel Serverless Functions:
1. **SoloSagre** - HTML scraping of Lombardy festivals/sagre (regex-based parsing)
2. **OpenData Lombardia** - Official regional API (dati.lombardia.it/resource/hs8z-dcey.json)
3. **InLombardia** - HTML scraping with AJAX pagination and JSON-LD detail page fetching

Vercel Cron triggers automated scraping every 4 hours. No external workflow tools are used.

**Data Flow:**
```
Vercel Cron (every 4h)
  -> /api/cron/scrape
  -> runAllScrapers()
  -> PostgreSQL (Supabase)
  -> /api/events
  -> Frontend
```

**Caching Strategy:**

Users receive instant responses (<1s) from cached data. When cache is stale (>4 hours), the API returns cached results immediately while triggering a background refresh. The cron job also refreshes data proactively every 4 hours.

## Prerequisites

- Node.js 18+ installed locally
- Vercel account (Pro plan required for 60s function timeout)
- Supabase PostgreSQL database
- Mapbox account (for map visualization)

## Environment Variables

| Variable | Required | Source | Description |
|----------|----------|--------|-------------|
| DATABASE_URL | Yes | Supabase Dashboard > Settings > Database > Connection string (Transaction mode / port 6543) | Prisma connection URL for connection pooling |
| DIRECT_URL | Yes | Supabase Dashboard > Settings > Database > Connection string (Session mode / port 5432) | Direct connection for migrations |
| NEXT_PUBLIC_APP_URL | Yes | Your deployment URL | App base URL (e.g., https://fuorirotta.vercel.app) |
| NEXT_PUBLIC_MAPBOX_TOKEN | Yes | Mapbox Dashboard > Access tokens | Public token for map rendering |
| CRON_SECRET | Yes | Generate with `openssl rand -base64 32` | Auth token for cron endpoint |

**Important:**
- DATABASE_URL must use transaction pooler (port 6543) for serverless compatibility
- DIRECT_URL must use session mode (port 5432) for Prisma migrations
- CRON_SECRET should be a strong random token (32+ characters)

## Local Development

```bash
cd frontend
cp .env.example .env.local
# Fill in environment variables in .env.local
npm install
npx prisma generate
npx prisma db push
npm run dev
```

The development server will start at http://localhost:3000.

**Running Scrapers Locally:**

Trigger a manual scrape for testing:
```bash
curl -X POST http://localhost:3000/api/cron/scrape \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Or use the scrape endpoint with custom parameters:
```bash
curl -X POST http://localhost:3000/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"dateFrom": "2026-02-01", "dateTo": "2026-03-01"}'
```

## Vercel Deployment

### Initial Setup

1. Import the project in Vercel Dashboard
2. **Set Root Directory to `frontend`** in project settings
3. Add all environment variables from the table above in Vercel Dashboard > Settings > Environment Variables
4. Deploy

### Vercel Pro Requirement

The InLombardia scraper requires up to 60 seconds for AJAX pagination and detail page fetching. Vercel Hobby plan limits serverless functions to 10 seconds.

**Vercel Pro ($20/month)** provides 60-second function timeout.

To upgrade: Vercel Dashboard > Settings > Billing > Upgrade to Pro

The cron endpoint already exports `maxDuration = 60` in `frontend/app/api/cron/scrape/route.ts`.

### Cron Configuration

The `frontend/vercel.json` file configures automated scraping:

```json
{
  "crons": [
    {
      "path": "/api/cron/scrape",
      "schedule": "0 */4 * * *"
    }
  ]
}
```

This runs at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC (every 4 hours).

Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` header when the cron job triggers. The endpoint validates this token to prevent unauthorized access.

**Verifying Cron Setup:**

After deployment, check Vercel Dashboard > Project > Cron Jobs tab to see scheduled runs and execution history.

### Manual Scraping

Trigger a manual scrape (useful for initial data population or testing):

```bash
curl -X POST https://your-domain.vercel.app/api/cron/scrape \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Or use the scrape endpoint with custom date range:

```bash
curl -X POST https://your-domain.vercel.app/api/scrape \
  -H "Content-Type: application/json" \
  -d '{"dateFrom": "2026-02-01", "dateTo": "2026-03-01"}'
```

## Database

### Schema

The database is managed by Prisma. Key models:

- **Event**: Scraped event data with unique constraint on (source, sourceId) to prevent duplicates
- **WorkflowExecution**: Tracks scraper runs (status, duration, event count, completion timestamp)
- **MapClusterCache**: Pre-computed GeoJSON cluster data for instant map rendering

### Running Migrations

**For production:**
```bash
cd frontend
npx prisma migrate deploy
```

**For development (quick schema sync):**
```bash
cd frontend
npx prisma db push
```

**Generating Prisma Client:**
```bash
cd frontend
npx prisma generate
```

Vercel automatically runs `prisma generate` during build, but you may need to run migrations manually if the schema changes.

## Monitoring

### Vercel Dashboard

- **Functions tab**: Check cron execution logs and performance metrics
- **Cron Jobs tab**: See cron run history, success/failure status, and next scheduled run
- **Deployments tab**: Monitor deployment status and build logs

### API Response Metadata

API responses include cache metadata for monitoring:

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

- `cache.fresh`: true if cache is <4 hours old
- `cache.age_hours`: Age of cached data in hours
- `cache.refreshing`: true if background refresh was triggered
- `cache.last_event_count`: Number of events in last scrape

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
  "clusterCacheUpdated": true,
  "errors": []
}
```

## Troubleshooting

### Cron Not Running

**Symptoms:** Scheduled scrapes not executing

**Solutions:**
1. Verify `CRON_SECRET` is set in Vercel environment variables
2. Check Vercel Dashboard > Cron Jobs tab for error messages
3. Ensure Vercel Pro plan is active (cron jobs require paid plan)
4. Verify `vercel.json` exists in frontend directory with correct cron configuration

### Function Timeout

**Symptoms:** Scraper fails with timeout error after 10 seconds

**Solutions:**
1. Ensure Vercel Pro plan is active (60s timeout required)
2. Verify `maxDuration = 60` is exported in `app/api/cron/scrape/route.ts`
3. Check function logs in Vercel Dashboard > Functions tab

### Empty Results on First Deploy

**Symptoms:** Frontend shows no events after initial deployment

**Solutions:**
1. Run manual scrape to populate initial data:
   ```bash
   curl -X POST https://your-domain.vercel.app/api/cron/scrape \
     -H "Authorization: Bearer YOUR_CRON_SECRET"
   ```
2. Check scraper response for errors
3. Verify database connection is working

### Database Connection Errors

**Symptoms:** Prisma errors, connection timeouts, or "Too many connections"

**Solutions:**
1. Verify `DATABASE_URL` uses transaction pooler (port 6543)
2. Verify `DIRECT_URL` uses session mode (port 5432)
3. Check Supabase Dashboard > Database > Connection pooling is enabled
4. Verify connection strings are correct (copy from Supabase Dashboard)

### Build Fails with "max clients reached" Error

**Symptoms:** Build fails during sitemap generation with error:
```
FATAL: MaxClientsInSessionMode: max clients reached - in Session mode max clients are limited to pool_size
Error occurred prerendering page "/sitemap.xml"
```

**Root Cause:** The sitemap attempts to query the database during build time (static generation), exhausting Neon/Supabase's connection pool in Session mode.

**Solution:** The sitemap has been configured for dynamic rendering with caching:
- `export const dynamic = 'force-dynamic'` - Generates sitemap at request time, not build time
- `export const revalidate = 3600` - Caches the sitemap for 1 hour

This eliminates database queries during build while keeping the sitemap fresh and performant.

### Map Not Loading

**Symptoms:** Map tiles not rendering or "Invalid access token" error

**Solutions:**
1. Verify `NEXT_PUBLIC_MAPBOX_TOKEN` is set in Vercel environment variables
2. Check Mapbox account is active and token is valid
3. Ensure token has public scope (starts with `pk.`)
4. Verify token is not restricted to specific URLs (or add your domain to allowed URLs)

### Slow API Responses

**Symptoms:** API takes >5 seconds to respond

**Solutions:**
1. Check cache is being populated (verify cron is running)
2. Run manual scrape to refresh cache
3. Check database query performance in Supabase Dashboard
4. Verify cluster cache is being updated (check `clusterCacheUpdated: true` in cron response)

## Performance Notes

- **InLombardia scraper**: Takes 5-40 seconds depending on date range and pagination depth
- **Total scrape time**: Typically 10-45 seconds for all three sources combined
- **API response time**: <1 second when serving from cache
- **Cache refresh**: Background refresh is non-blocking (users never wait)
- **Cluster cache**: Pre-computed in cron job for instant map rendering

## Security

- Cron endpoint is protected by `CRON_SECRET` Bearer token
- Database credentials are stored in Vercel environment variables (not in code)
- Public Mapbox token is safe to expose (restricted to map rendering only)
- No user authentication required (public event discovery)

## Next Steps After Deployment

1. Run initial scrape to populate database with events
2. Verify cron job runs successfully (check Cron Jobs tab)
3. Test API endpoints return events correctly
4. Verify map displays events with correct clusters
5. Monitor function execution times in Vercel Dashboard
6. Set up Vercel deployment notifications (optional)

---

*For issues or questions, check Vercel function logs and scraper execution metrics first.*
