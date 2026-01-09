# Fuorirotta Frontend

Web application moderna per la scoperta di eventi in Lombardia, costruita con Next.js 15, TypeScript, Tailwind CSS e Prisma ORM con sistema di cache ottimizzato e integrazione n8n.

## 🎯 Features Principali

✅ **Performance Ottimizzate**: Lettura diretta dal database (<1s caricamento)
✅ **Cache Intelligente**: Sistema di refresh manuale con endpoint dedicato
✅ **Infinite Scroll**: Caricamento progressivo con paginazione corretta (100 eventi/pagina)
✅ **Filtri Avanzati**: Città, raggio geografico (Haversine), periodo, categoria
✅ **Coordinate Fallback**: Eventi senza GPS usano coordinate città (12 città lombarde)
✅ **Mappa Interattiva**: Visualizzazione 447 eventi con cluster Mapbox GL
✅ **Integrazione n8n**: Refresh dati via webhook on-demand
✅ **Responsive**: Ottimizzato per mobile, tablet e desktop

---

## 📋 Stack Tecnologico

### Frontend
- **Framework**: Next.js 15 (App Router)
- **Linguaggio**: TypeScript
- **Styling**: Tailwind CSS 4
- **Mappe**: Mapbox GL + Leaflet fallback
- **Animazioni**: Framer Motion
- **Date**: date-fns

### Backend
- **Database**: PostgreSQL 16 (shared con n8n)
- **ORM**: Prisma 7.2
- **Cache**: PostgreSQL table `workflow_executions`
- **Scraper**: n8n workflow (trigger via webhook)

---

## 🏗️ Architettura Sistema (Ottimizzata)

### Flusso Dati: Frontend → API → Database (Lettura Diretta)

```
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND (React)                                            │
│ - Navbar con filtri (città, raggio, periodo)               │
│ - Infinite scroll (100 eventi/page)                        │
│ - EventsMap (Mapbox clustering - 447 eventi)               │
│ - Coordinate fallback per città senza GPS                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ GET /api/events?location=Milano&radius=20&...
                     │
┌────────────────────▼────────────────────────────────────────┐
│ API LAYER (/app/api/events/route.ts)                       │
│                                                             │
│ 1. Parse parametri query                                   │
│ 2. ✅ QUERY DATABASE (sempre, senza trigger n8n)            │
│    - Filtro città                                          │
│    - Filtro date (da oggi in poi)                          │
│    - Filtro categoria                                      │
│    - Fetch TUTTI gli eventi se filtro raggio attivo        │
│                                                             │
│ 3. ✅ FILTRO RAGGIO (post-query, Haversine in memoria)      │
│    IF lat && lng && radius:                                │
│      - Calcola distanza per ogni evento                    │
│      - Filtra eventi dentro raggio                         │
│      - Applica paginazione su risultati filtrati           │
│                                                             │
│ 4. Return JSON (< 1s)                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ REFRESH ENDPOINT (/app/api/refresh - MANUALE)              │
│                                                             │
│ POST /api/refresh (manuale o cron job)                     │
│    ↓                                                        │
│ 1. createWorkflowExecution()                               │
│ 2. triggerN8nWorkflow()                                    │
│    ↓                                                        │
│ 3. Optional: waitForExecution(120s)                        │
└────────────────────┬────────────────────────────────────────┘
                     │ Webhook POST
                     │
┌────────────────────▼────────────────────────────────────────┐
│ N8N WORKFLOW (Raspberry Pi @ 192.168.0.130)               │
│                                                             │
│ [Webhook] → [Parse Params] → [Generate Pagination]         │
│      ↓                                                      │
│ [Loop OpenData Lombardia API]                              │
│   ├─ Request 1: offset=0,   limit=2000                     │
│   ├─ Request 2: offset=2000, limit=2000                    │
│   └─ Request 3: offset=4000, limit=2000                    │
│      ↓                                                      │
│ [Merge Pages] → [Transform] → [Filter Dates]               │
│      ↓                                                      │
│ [Geocoding per eventi senza coordinate]                    │
│      ↓                                                      │
│ [INSERT DB] ON CONFLICT UPDATE                             │
│      ↓                                                      │
│ [Update Cache Table: status=completed]                     │
│      ↓                                                      │
│ [Return Response]                                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ INSERT INTO events / workflow_executions
                     │
┌────────────────────▼────────────────────────────────────────┐
│ POSTGRESQL DATABASE (crimescript-db)                       │
│                                                             │
│ ┌─────────────────────┐  ┌────────────────────────────┐   │
│ │ events (~1000)      │  │ workflow_executions        │   │
│ ├─────────────────────┤  ├────────────────────────────┤   │
│ │ id (PK)             │  │ id (PK)                    │   │
│ │ source              │  │ query_hash (UNIQUE)        │   │
│ │ source_id           │  │ cities[]                   │   │
│ │ title               │  │ radius_km                  │   │
│ │ description         │  │ date_from / date_to        │   │
│ │ date_start          │  │ last_executed_at           │   │
│ │ date_end            │  │ status (pending/running/   │   │
│ │ location_name       │  │         completed/failed)  │   │
│ │ latitude/longitude  │  │ event_count                │   │
│ │ category            │  │ n8n_execution_id           │   │
│ │ image_url           │  └────────────────────────────┘   │
│ │ created_at          │                                   │
│ │ updated_at          │  Indexes:                         │
│ └─────────────────────┘  - query_hash (UNIQUE)            │
│                          - last_executed_at               │
│ UNIQUE(source,          - status                          │
│        source_id)       - date_start, category,           │
│                           location_name (composite)       │
└───────────────────────────────────────────────────────────┘
```

---

## 🗄️ Schema Database

### Tabella `events`
Eventi aggregati da multiple fonti (OpenData Lombardia, SoloSagre, etc.)

```sql
CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  source VARCHAR(50) NOT NULL,
  source_id VARCHAR(255) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  date_start TIMESTAMP NOT NULL,
  date_end TIMESTAMP,
  location_name VARCHAR(255),
  address VARCHAR(500),
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  category VARCHAR(100),
  source_url VARCHAR(1000),
  image_url VARCHAR(1000),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(source, source_id)
);
```

### Tabella `workflow_executions` (NUOVA - Cache System)
Traccia esecuzioni workflow n8n per caching intelligente (TTL 4 ore)

```sql
CREATE TABLE workflow_executions (
  id SERIAL PRIMARY KEY,
  query_hash VARCHAR(64) UNIQUE NOT NULL,  -- SHA-256(città+raggio+periodo)
  location VARCHAR(255),
  radius_km INT,
  date_from DATE,
  date_to DATE,
  cities TEXT[],
  last_executed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  event_count INT DEFAULT 0,
  error_message TEXT,
  n8n_execution_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Stati workflow**:
- `pending`: Creato, in attesa di esecuzione
- `running`: n8n workflow in esecuzione
- `completed`: Completato con successo
- `failed`: Errore durante esecuzione

---

## 🚀 Setup Locale

### Prerequisiti

- Node.js 20+
- npm o yarn
- PostgreSQL database (Raspberry Pi o locale)
- n8n instance (per trigger workflow)

---

## 📂 Struttura Progetto

```
frontend/
├── app/
│   ├── api/
│   │   ├── events/
│   │   │   ├── route.ts              # ✨ API con cache logic
│   │   │   └── [id]/route.ts         # Dettaglio evento
│   │   └── categories/route.ts       # Lista categorie
│   ├── eventi/[id]/page.tsx          # Pagina dettaglio evento
│   ├── page.tsx                       # ✨ Homepage con infinite scroll
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── Navbar.tsx                     # ✨ Filtri con raggio connesso
│   ├── EventCard.tsx
│   └── EventsMap.tsx
├── lib/
│   ├── hooks/
│   │   └── useInfiniteScroll.ts      # ✨ Hook infinite scroll
│   ├── n8nClient.ts                  # ✨ Trigger n8n webhook
│   ├── cacheService.ts               # ✨ Cache check & management
│   ├── cityCoordinates.ts            # ✨ Lookup coordinate città Lombardia
│   ├── prisma.ts                      # Prisma singleton
│   └── types.ts
├── prisma/
│   ├── schema.prisma                  # ✨ + WorkflowExecution model
│   └── migrations/
│       └── YYYYMMDDHHMMSS_add_workflow_executions/
│           └── migration.sql          # ✨ Migrazione cache table
├── .env.example
├── .env.local                         # ✨ + N8N_WEBHOOK_URL/SECRET
├── package.json
└── README.md
```

**Legenda**: ✨ = File nuovi o modificati nell'ultimo upgrade

---

## 🔌 API Endpoints

### GET /api/events

**Descrizione**: Recupera eventi dal database (lettura diretta, nessun trigger n8n automatico)

**Query Parameters**:
| Param | Type | Description | Default |
|-------|------|-------------|---------|
| `location` | string | Nome città o "Nelle vicinanze" | - |
| `search` | string | Ricerca testuale (fallback) | - |
| `category` | string | Categoria evento | `all` |
| `dateFrom` | ISO 8601 | Data inizio periodo | today |
| `dateTo` | ISO 8601 | Data fine periodo | end of year |
| `lat` | number | Latitudine utente | - |
| `lng` | number | Longitudine utente | - |
| `radius` | number | Raggio ricerca (km) | - |
| `limit` | number | Eventi per pagina | 100 |
| `offset` | number | Pagination offset | 0 |

**Esempio Request**:
```bash
GET /api/events?location=Milano&radius=20&dateFrom=2026-01-01&dateTo=2026-03-31&limit=100&offset=0
```

**Response**:
```json
{
  "events": [ /* array di eventi */ ],
  "total": 245,
  "limit": 100,
  "offset": 0,
  "cache": {
    "hit": false,
    "age_hours": null
  }
}
```

**Performance**:
- Senza filtro raggio: Query DB standard con paginazione (<100ms)
- Con filtro raggio: Fetch tutti eventi + filtro Haversine + paginazione (~500ms per 1000 eventi)

---

### POST /api/refresh

**Descrizione**: Trigger manuale refresh dati da OpenData Lombardia via n8n workflow

**Request Body** (opzionale):
```json
{
  "cities": ["Milano", "Bergamo"],  // Default: tutte le città lombarde
  "dateFrom": "2026-01-09",          // Default: oggi
  "dateTo": "2026-12-31",            // Default: fine anno
  "wait": true                       // Default: false (risponde subito)
}
```

**Esempio Request**:
```bash
# Trigger immediato (non aspetta completamento)
curl -X POST http://localhost:3000/api/refresh

# Trigger e attendi completamento (max 2 minuti)
curl -X POST http://localhost:3000/api/refresh \
  -H "Content-Type: application/json" \
  -d '{"wait": true}'

# Refresh solo Milano e Bergamo
curl -X POST http://localhost:3000/api/refresh \
  -H "Content-Type: application/json" \
  -d '{"cities": ["Milano", "Bergamo"]}'
```

**Response** (wait=false):
```json
{
  "success": true,
  "message": "Data refresh triggered successfully",
  "executionId": "42",
  "note": "Refresh is running in background"
}
```

**Response** (wait=true):
```json
{
  "success": true,
  "message": "Data refresh completed successfully",
  "executionId": "42"
}
```

**Uso consigliato**:
- **Manuale**: Chiamare quando servono dati aggiornati
- **Cron Job**: Setup automatico (es. ogni 6 ore)
  ```bash
  # Crontab esempio: ogni 6 ore
  0 */6 * * * curl -X POST http://localhost:3000/api/refresh
  ```

---

### GET /api/events/:id

**Descrizione**: Dettaglio singolo evento

**Response**:
```json
{
  "id": 123,
  "title": "Sagra del Fungo Porcino",
  "description": "...",
  "dateStart": "2026-09-15T10:00:00.000Z",
  "locationName": "Crema",
  "latitude": 45.3631,
  "longitude": 9.6875,
  "category": "Sagra",
  ...
}
```

---

### GET /api/categories

**Descrizione**: Lista categorie con conteggio

**Response**:
```json
[
  { "name": "Sagra", "count": 450 },
  { "name": "Concerto", "count": 120 }
]
```

---

## 📝 Workflow Completo Richiesta Utente

### Scenario 1: Caricamento Eventi (Normale)

```
1. Utente seleziona "Milano" + "20 km" + date range
   ↓
2. Click "Cerca" (o auto-search con geolocation)
   ↓
3. Frontend: fetch('/api/events?lat=45.46&lng=9.19&radius=20&...')
   ↓
4. API: Query Database
   - WHERE date_start >= oggi AND date_start <= dateTo
   - Fetch TUTTI gli eventi (no pagination se radius attivo)
   ↓
5. API: Filtro Raggio (Haversine in memoria)
   - Per ogni evento: distance = haversine(userLat, userLng, eventLat, eventLng)
   - Keep only if distance <= 20 km
   ↓
6. API: Paginazione sui risultati filtrati
   - events.slice(offset, offset + 100)
   ↓
7. API: Return JSON (< 500ms)
   {
     "events": [...], // 100 eventi
     "total": 245,    // Totali nel raggio
     "limit": 100,
     "offset": 0
   }
   ↓
8. Frontend: Render 100 eventi
   - EventCard grid (sinistra)
   - EventsMap con 447 features GeoJSON + clustering (destra)
   ↓
9. Utente scrolla in fondo
   ↓
10. Infinite scroll: fetchMoreEvents() con offset=100
   ↓
11. API: Stessa query, offset=100 → Return next 100
   ↓
12. Frontend: Append altri 100 eventi (deduplicazione per ID)
```

### Scenario 2: Refresh Dati (Manuale)

```
1. Admin/Cron: POST /api/refresh
   ↓
2. API: createWorkflowExecution()
   - Genera query_hash per cache tracking
   - Status: pending
   ↓
3. API: triggerN8nWorkflow()
   - POST http://192.168.0.130:5678/webhook/fuorirotta-scrape
   - Body: { query: {...}, execution_id: "42" }
   ↓
4. n8n Workflow (background)
   - Webhook Trigger
   - Parse Input
   - Generate Pagination (offset 0, 2000, 4000...)
   - Loop HTTP Requests OpenData Lombardia
   - Merge Pages
   - Transform Data
   - Geocoding per eventi senza coordinate
   - INSERT DB (ON CONFLICT UPDATE)
   - UPDATE workflow_executions SET status='completed'
   ↓ (60-120s)
5. API: Return immediate response (se wait=false)
   {
     "success": true,
     "executionId": "42",
     "note": "Refresh is running in background"
   }
```

### Scenario 3: Eventi senza Coordinate GPS

```
1. Evento da DB senza latitude/longitude
   ↓
2. EventsMap: getEventCoordinates(event)
   ↓
3. Check: event.latitude && event.longitude?
   - YES → Return { lat, lng } (coordinate reali)
   - NO  → Lookup città in CITY_COORDINATES
   ↓
4. Match locationName con città Lombardia
   - "Milano" → { lat: 45.4642, lng: 9.1900 }
   - "Bergamo" → { lat: 45.6983, lng: 9.6773 }
   - ...
   ↓
5. Return coordinate città come fallback
   ↓
6. Evento viene visualizzato sulla mappa
   - Pin posizionato sulla città
   - Clustering con altri eventi stessa città
```

---

## 🚀 Deployment

### Production Build

```bash
# Local test
npm run build
npm run start

# Docker
docker build -t fuorirotta-frontend .
docker run -p 3000:3000 --env-file .env fuorirotta-frontend
```

---

## 🔧 Ottimizzazioni Implementate (Gennaio 2025)

### Performance
- ✅ **Cache ottimizzata**: Lettura diretta DB invece di trigger n8n automatico (~90s → <1s)
- ✅ **Paginazione corretta**: 100 eventi/pagina invece di 50, con filtro raggio pre-paginazione
- ✅ **Filtro Haversine**: Calcolo distanze in memoria invece di SQL raw (più affidabile)

### Visualizzazione Mappa
- ✅ **447 eventi visibili**: Corretto bug 251 features (1 feature per evento invece che per location)
- ✅ **Coordinate fallback**: Lookup 12 città lombarde per eventi senza GPS
- ✅ **Clustering Mapbox**: Configurazione ottimale (max zoom 14, radius 50px)

### API
- ✅ **Nuovo endpoint `/api/refresh`**: Separato refresh dati da lettura
- ✅ **Filtro date corretto**: Solo eventi da oggi in poi
- ✅ **Filtro città case-insensitive**: Usa `contains` con `mode: 'insensitive'` per matching flessibile
- ✅ **Response ottimizzate**: Cache info per debug, total sempre corretto

### Filtri & UX
- ✅ **Filtro "Nelle vicinanze" funzionante**: Non passa `location` all'API quando usa raggio, solo `lat/lng/radius`
- ✅ **Input location protetto**: Campo readonly quando "Nelle vicinanze" è attivo, impedisce modifiche accidentali
- ✅ **Capitalizzazione automatica**: Prima lettera sempre maiuscola nei nomi città (es. "milano" → "Milano")
- ✅ **Lista città completa**: Tutte le 12 città lombarde sempre visibili (approccio statico)
- ✅ **Reset intelligente**: Digitare manualmente resetta automaticamente "Nelle vicinanze"

### Codebase
- ✅ **cityCoordinates.ts**: Utility per gestione coordinate città con fallback
- ✅ **Rimosso SQL raw**: Più manutenibile con Prisma ORM standard
- ✅ **Fix TypeScript**: Tipi espliciti per `cacheResult` in route.ts
- ✅ **Rimosso emoji dai commenti**: Compatibilità con tutti gli editor

---

## 🤝 Contributi

Progetto privato - Solo team interno.

---

## 📄 Licenza

Fuorirotta © 2025 - All rights reserved
