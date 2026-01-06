# 🚀 Fuorirotta Platform - Deployment Steps

## ✅ Completed Automatically

The following have been implemented and are ready to use:

- ✅ **Database Schema**: `WorkflowExecution` model added to Prisma schema
- ✅ **Backend Services**:
  - `/lib/n8nClient.ts` - n8n webhook triggering and query hashing
  - `/lib/cacheService.ts` - Cache management with 4-hour TTL
- ✅ **API Integration**: `/app/api/events/route.ts` - Complete cache logic
- ✅ **Frontend Features**:
  - Infinite scroll hook (`/lib/hooks/useInfiniteScroll.ts`)
  - Updated home page with pagination
  - Radius filter connected in Navbar
- ✅ **Environment Config**: `.env.local` with n8n variables
- ✅ **n8n Workflow**: Modified with webhook trigger, dynamic parameters, and cache updates
- ✅ **Documentation**: Complete README.md with architecture

---

## 🔧 Manual Steps Required

### Step 1: Database Migration (CRITICAL - Do This First!)

The database migration file has been created but needs to be executed on the Raspberry Pi.

**Migration File Location**:
```
/prisma/migrations/20260106121739_add_workflow_executions/migration.sql
```

**Execute on Raspberry Pi**:

```bash
# Option 1: Via Docker exec
ssh pi@192.168.0.130
docker exec -i crimescript-db psql -U fuorirotta -d fuorirotta < /path/to/migration.sql

# Option 2: Via psql client
ssh pi@192.168.0.130
PGPASSWORD='Fuor1rott@2025!' psql -h localhost -p 5432 -U fuorirotta -d fuorirotta -f /path/to/migration.sql
```

**Verify Migration**:
```sql
-- Connect to database
docker exec -it crimescript-db psql -U fuorirotta -d fuorirotta

-- Check table exists
\dt workflow_executions

-- Check structure
\d workflow_executions

-- Should show:
-- - id (serial primary key)
-- - query_hash (varchar(64) unique)
-- - location, radius_km, date_from, date_to, cities
-- - last_executed_at, status, event_count, error_message, n8n_execution_id
-- - created_at, updated_at
-- - 3 indexes on query_hash, last_executed_at, status
```

---

### Step 2: Configure n8n Webhook Authentication

The webhook trigger has been added to the workflow but needs authentication configuration.

**In n8n UI** (http://192.168.0.130:5678):

1. Open workflow: **"Fuorirotta - Multi-Source Scraper"**

2. Click on **"Webhook Trigger - Scrape Request"** node

3. Configure Authentication:
   - **Method**: Header Auth
   - **Header Name**: `Authorization`
   - **Credential Type**: Create new "Header Auth" credential
   - **Header Value**: `Bearer 9dOrFLyLt4Cn+D5n2ZPSJVCX7kifsLiXL0Yf0EyJjxI=`

4. Save the credential

5. **Activate the workflow** (toggle switch at top-right)

**Verify Webhook URL**:
After activation, the webhook URL should be:
```
http://192.168.0.130:5678/webhook/fuorirotta-scrape
```

---

### Step 3: Update OpenData Lombardia HTTP Request

The HTTP Request node for OpenData needs the URL updated to use dynamic parameters.

**In n8n UI**:

1. Click on **"HTTP Request - OpenData Lombardia"** node

2. Update the URL to use an expression:

**Replace the current static URL with**:
```javascript
={{ 'https://www.dati.lombardia.it/resource/hs8z-dcey.json?$limit=2000&$offset=0&$where=data_in>=\'' + $('Parse Query Parameters').item.json.dateFrom + '\'%20AND%20data_in<=\'' + $('Parse Query Parameters').item.json.dateTo + '\'&$order=data_in%20DESC' }}
```

**What this does**:
- Removes the 1000 event limit (now fetches up to 2000 per request)
- Filters by date range from query parameters
- Orders by date descending

3. Save the workflow

---

### Step 4: Configure PostgreSQL Credentials for Cache Update Node

The "Update Workflow Cache" node needs database credentials.

**In n8n UI**:

1. Click on **"Update Workflow Cache"** node

2. Under **Credentials**, select: **"Fuorirotta db"** (should already exist)

3. Verify the **Operation** is set to: **"Insert"**

4. Check **Options** → **"Skip on Conflict"** is enabled ✅

5. Save the workflow

---

### Step 5: Test the Complete System

#### 5.1 Test n8n Webhook Locally

From your Mac terminal:

```bash
# Test webhook trigger (should return 401 without auth)
curl -X POST http://192.168.0.130:5678/webhook/fuorirotta-scrape

# Test with authentication
curl -X POST http://192.168.0.130:5678/webhook/fuorirotta-scrape \
  -H "Authorization: Bearer 9dOrFLyLt4Cn+D5n2ZPSJVCX7kifsLiXL0Yf0EyJjxI=" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "cities": ["Milano"],
      "radiusKm": 20,
      "centerLat": 45.4654,
      "centerLng": 9.1859,
      "dateFrom": "2026-01-06",
      "dateTo": "2026-12-31",
      "query_hash": "test123"
    },
    "execution_id": "test-001"
  }'
```

**Expected Result**: Workflow should execute and scrape events for Milano within 20km.

#### 5.2 Test Frontend API with Cache

```bash
# Start Next.js dev server
cd /Users/alessandroamormino/Projects/fuorirotta/frontend
npm run dev

# Open browser to:
http://localhost:3000

# Test scenarios:
# 1. Initial load (should trigger n8n if cache is empty)
# 2. Same search within 4 hours (should use cache)
# 3. Different city (should trigger new n8n execution)
# 4. Scroll down (should load more events via infinite scroll)
```

#### 5.3 Verify Cache Table

```bash
# Connect to database
ssh pi@192.168.0.130
docker exec -it crimescript-db psql -U fuorirotta -d fuorirotta

# Check cache entries
SELECT
  id,
  query_hash,
  location,
  status,
  event_count,
  EXTRACT(EPOCH FROM (NOW() - last_executed_at))/3600 as age_hours
FROM workflow_executions
ORDER BY last_executed_at DESC;

# Should show:
# - Recent executions with status 'completed'
# - Different query_hash for different search parameters
# - age_hours < 4 for cached entries
```

---

## 🎯 Success Criteria Checklist

- [ ] **Migration Complete**: `workflow_executions` table exists in database
- [ ] **Webhook Active**: n8n workflow is active and webhook URL is accessible
- [ ] **Authentication Working**: Webhook requires Bearer token
- [ ] **Cache Functional**: Same query returns cache within 4 hours
- [ ] **No 1000 Limit**: OpenData Lombardia returns more than 1000 events
- [ ] **Infinite Scroll**: Frontend loads 50 events at a time on scroll
- [ ] **Filters Work**: City, radius, and date filters trigger correct workflow parameters
- [ ] **Cache Entries**: `workflow_executions` table gets populated after searches

---

## 📊 Expected Performance

### Before Upgrade:
- ❌ Hard limit of 1000 events from OpenData
- ❌ Full workflow execution on every page load (~30-60 seconds)
- ❌ No filtering by city or radius in n8n
- ❌ Load all events at once (performance issues)

### After Upgrade:
- ✅ Up to 2000 events per OpenData request (pagination ready for more)
- ✅ Cache hit returns in < 100ms
- ✅ Workflow only executes once per unique query per 4 hours
- ✅ Dynamic filtering by city, radius, date range
- ✅ Infinite scroll with 50 events per page

---

## 🐛 Troubleshooting

### Issue: Migration Fails with "permission denied"

**Solution**: The database user needs CREATE TABLE permissions. Grant them:

```sql
GRANT CREATE ON SCHEMA public TO fuorirotta;
ALTER USER fuorirotta CREATEDB;
```

### Issue: Webhook Returns 404

**Cause**: Workflow is not activated.

**Solution**: In n8n UI, click the toggle at top-right to activate the workflow.

### Issue: Cache Always Misses

**Cause**: Query hash generation might differ between frontend and backend.

**Debug**:
```javascript
// In browser console on localhost:3000
console.log(window.location.search);

// Check n8n execution logs
// Verify query_hash values match
```

### Issue: OpenData Still Returns 1000 Events

**Cause**: URL not updated with expression.

**Solution**: Ensure you used the expression syntax (with `={{  }}`) in the HTTP Request node URL field.

### Issue: "Column workflow_executions.query_hash does not exist"

**Cause**: Migration not applied.

**Solution**: Run migration SQL manually on Raspberry Pi (Step 1).

---

## 📝 Next Steps After Deployment

1. **Monitor Cache Hit Rate**:
   ```sql
   SELECT
     COUNT(*) as total_executions,
     AVG(EXTRACT(EPOCH FROM (NOW() - last_executed_at))/3600) as avg_age_hours
   FROM workflow_executions;
   ```

2. **Implement Pagination for More Than 2000 Events**:
   - Add a Loop node in n8n to fetch multiple pages
   - Use `$offset` parameter: 0, 2000, 4000, etc.

3. **Add More Data Sources** (as per original plan):
   - MilanoToday Events
   - In-Lombardia.it
   - BergamoToday, LeccoToday, QuiComo

4. **Optimize Cache TTL**:
   - Adjust `CACHE_TTL_HOURS` in `/lib/cacheService.ts` if needed
   - Consider shorter TTL for popular queries, longer for rare queries

5. **Add Cache Invalidation API**:
   - Create `/api/cache/invalidate` endpoint
   - Allow manual cache refresh for specific queries

---

## 🔐 Security Notes

- **Never commit** `.env.local` with real secrets to Git
- **Webhook Secret**: Change `N8N_WEBHOOK_SECRET` in production
- **Database Password**: Use environment variables, never hardcode
- **Bearer Token**: Rotate periodically (every 3-6 months)

---

## 📞 Support

If you encounter any issues:

1. Check n8n execution logs: http://192.168.0.130:5678 → Executions
2. Check Next.js console: Browser DevTools → Console
3. Check API logs: Terminal running `npm run dev`
4. Check database: Query `workflow_executions` table for errors

---

**Generated**: 2026-01-06
**Last Updated**: After automatic workflow modifications
**Status**: Ready for manual steps ⚡
