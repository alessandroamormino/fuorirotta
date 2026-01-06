# Fuorirotta Frontend

Web application moderna per la scoperta di eventi in Lombardia, costruita con Next.js 15, TypeScript, Tailwind CSS e Prisma ORM con sistema di cache intelligente integrato con n8n.

## 🎯 Features Principali

✅ **Cache Intelligente**: Sistema di caching a 4 ore con gestione concorrenza
✅ **Infinite Scroll**: Caricamento progressivo eventi con lazy loading
✅ **Filtri Avanzati**: Città, raggio geografico, periodo, categoria
✅ **Integrazione n8n**: Trigger dinamico workflow per scraping on-demand
✅ **Mappa Interattiva**: Visualizzazione eventi con cluster Mapbox
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

## 🏗️ Architettura Sistema

### Flusso Dati: Frontend → API → Cache → n8n → Database

```
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND (React)                                            │
│ - Navbar con filtri (città, raggio, periodo)               │
│ - Infinite scroll (50 eventi/page)                         │
│ - EventsMap (Mapbox clustering)                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ GET /api/events?location=Milano&radius=20&...
                     │
┌────────────────────▼────────────────────────────────────────┐
│ API LAYER (/app/api/events/route.ts)                       │
│                                                             │
│ 1. Parse parametri query                                   │
│ 2. Genera query hash (SHA-256)                             │
│ 3. ✅ CHECK CACHE (workflow_executions)                     │
│    │                                                        │
│    ├─ Cache HIT (< 4h) ──────────────┐                     │
│    ├─ Workflow RUNNING ─────────┐    │                     │
│    └─ Cache MISS ──────┐        │    │                     │
│                        │        │    │                     │
│ 4. ✅ TRIGGER n8n       │        │    │                     │
│    POST webhook        │        │    │                     │
│    ↓                   │        │    │                     │
│ 5. Wait execution     │        │    │                     │
│    (90s timeout)      │        │    │                     │
│    ↓                   │        │    │                     │
│ 6. ✅ QUERY DATABASE ←─┴────────┴────┘                     │
│    - Filtro città                                          │
│    - Filtro date                                           │
│    - Filtro categoria                                      │
│    - Pagination (limit/offset)                             │
│ 7. Filtro raggio (post-query, Haversine)                   │
│ 8. Return JSON                                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Webhook POST
                     │
┌────────────────────▼────────────────────────────────────────┐
│ N8N WORKFLOW (Raspberry Pi)                                │
│                                                             │
│ [Webhook] → [Parse Params] → [Generate Pagination]         │
│      ↓                                                      │
│ [Loop OpenData Lombardia]                                  │
│   ├─ Request 1: offset=0,   limit=2000                     │
│   ├─ Request 2: offset=2000, limit=2000                    │
│   └─ Request 3: ...                                        │
│      ↓                                                      │
│ [Merge Pages] → [Transform] → [Filter Dates]               │
│      ↓                                                      │
│ [Insert DB] + [Update Cache Table]                         │
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
│ │ events              │  │ workflow_executions        │   │
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
│        source_id)                                         │
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

**Descrizione**: Recupera eventi con cache intelligente e trigger n8n automatico

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
| `limit` | number | Eventi per pagina | 50 |
| `offset` | number | Pagination offset | 0 |

**Esempio Request**:
```
GET /api/events?location=Milano&radius=20&dateFrom=2026-01-01&dateTo=2026-03-31&limit=50&offset=0
```

**Response**:
```json
{
  "events": [ /* array di eventi */ ],
  "total": 245,
  "limit": 50,
  "offset": 0,
  "cache": {
    "hit": true,
    "age_hours": 2.3
  }
}
```

**Cache Logic**:
1. Se cache < 4h: ritorna dati DB immediatamente
2. Se workflow running: attende 5s poi query DB
3. Se cache miss: trigger n8n → attende 90s → query DB

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

```
1. Utente seleziona "Milano" + "20 km" + date range
   ↓
2. Click "Cerca"
   ↓
3. Frontend: fetch('/api/events?location=Milano&radius=20&...')
   ↓
4. API: generateQueryHash({ cities: ['Milano'], radiusKm: 20, ... })
   ↓
5. API: checkCache(queryHash)
   ├─ Cache HIT (< 4h) ───→ Query DB ───→ Return JSON (< 100ms)
   │
   └─ Cache MISS ───→ createWorkflowExecution()
                   ↓
                   triggerN8nWorkflow()
                   ↓
                   n8n: Webhook → Parse → Paginate → Scrape → Insert DB + Update Cache
                   ↓ (60-90s)
                   waitForExecution(executionId)
                   ↓
                   Query DB ───→ Return JSON

6. Frontend: Render 50 eventi
   ↓
7. Utente scrolla in fondo
   ↓
8. Infinite scroll: fetchMoreEvents() con offset=50
   ↓
9. API: Cache già presente → Query DB (immediate)
   ↓
10. Frontend: Append altri 50 eventi
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

## 🤝 Contributi

Progetto privato - Solo team interno.

---

## 📄 Licenza

Fuorirotta © 2025 - All rights reserved
