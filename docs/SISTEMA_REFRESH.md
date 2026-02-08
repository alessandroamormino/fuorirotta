# 🔄 Sistema di Refresh Automatico - Fuorirotta

## 📋 Panoramica

Il sistema utilizza una **strategia ibrida intelligente** che combina:
1. **Refresh Globale Schedulato** (ogni 4 ore) - mantiene i dati sempre freschi
2. **Refresh On-Demand** (alla ricerca) - gestisce ricerche su dati non ancora presenti

---

## 🏗️ Architettura

```
┌─────────────────────────────────────────────────────────────────┐
│ N8N WORKFLOW - DUE TRIGGER                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────┐         ┌─────────────────────────┐      │
│  │ Schedule Trigger  │         │ Webhook Trigger         │      │
│  │ (Ogni 4 ore)      │         │ (On-Demand)             │      │
│  └─────────┬─────────┘         └───────────┬─────────────┘      │
│            │                               │                    │
│            └────────────┬──────────────────┘                    │
│                         │                                       │
│                ┌────────▼────────┐                              │
│                │ Parse Query     │                              │
│                │ Parameters      │                              │
│                │                 │                              │
│                │ Detecta source: │                              │
│                │ - Schedule → tutte città, oggi+6 mesi          │
│                │ - Webhook → parametri utente                   │
│                └────────┬────────┘                              │
│                         │                                       │
│              ┌──────────┴──────────┐                            │
│              │                     │                            │
│     ┌────────▼────────┐   ┌────────▼────────┐                   │
│     │ HTTP Request    │   │ HTTP Request    │                   │
│     │ SoloSagre       │   │ OpenData        │                   │
│     └────────┬────────┘   └────────┬────────┘                   │
│              │                     │                            │
│     ┌────────▼────────┐   ┌────────▼────────┐                   │
│     │ Parse HTML      │   │ Transform Data  │                   │
│     └────────┬────────┘   └────────┬────────┘                   │
│              │                     │                            │
│     ┌────────▼────────┐   ┌────────▼────────┐                   │
│     │ Transform       │   │ Filter Valid    │                   │
│     │ (case-insens.)  │   │ (case-insens.)  │                   │
│     └────────┬────────┘   └────────┬────────┘                   │
│              │                     │                            │
│              └──────────┬──────────┘                            │
│                         │                                       │
│                  ┌──────▼──────┐                                │
│                  │ Merge       │                                │
│                  └──────┬──────┘                                │
│                         │                                       │
│                  ┌──────▼──────┐                                │
│                  │ Insert DB   │                                │
│                  │ (upsert)    │                                │
│                  └──────┬──────┘                                │
│                         │                                       │
│                  ┌──────▼──────┐                                │
│                  │ Update Cache│                                │
│                  └─────────────┘                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ FRONTEND - RICERCA UTENTE                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Search → GET /api/events                                  │
│                      │                                          │
│                      ├─ 1. Query Database                       │
│                      │                                          │
│                      ├─ 2. Check risultati:                     │
│                      │                                          │
│                      │   CASO A: 0 eventi trovati               │
│                      │   ├─ Triggera n8n (SINCRONO)             │
│                      │   ├─ Aspetta max 2 minuti                │
│                      │   └─ Re-fetch e mostra risultati         │
│                      │                                          │
│                      │   CASO B: Eventi trovati + cache >4h     │
│                      │   ├─ Mostra eventi dal DB (immediato)    │
│                      │   └─ Triggera n8n (ASINCRONO background) │
│                      │                                          │
│                      │   CASO C: Eventi trovati + cache <4h     │
│                      │   └─ Mostra solo eventi dal DB           │
│                      │                                          │
│                      └─ 3. Return JSON                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## ⏰ Refresh Globale Schedulato

### Configurazione
- **Frequenza:** Ogni 4 ore
- **Trigger:** Schedule Trigger n8n
- **Scope:** Tutte le città lombarde
- **Range:** Da oggi a +6 mesi

### Parametri Automatici
```javascript
{
  cities: ['Milano', 'Bergamo', 'Brescia', 'Como', 'Cremona',
            'Lecco', 'Lodi', 'Mantova', 'Monza', 'Pavia',
            'Sondrio', 'Varese', 'Erba'],
  dateFrom: '2026-01-10',  // oggi
  dateTo: '2026-07-10',    // +6 mesi
  queryHash: 'scheduled_refresh',
  isScheduled: true
}
```

### Comportamento
1. Parte automaticamente ogni 4 ore
2. Scarica eventi da SoloSagre + OpenData Lombardia
3. Salva/aggiorna eventi nel database
4. Aggiorna cache con timestamp esecuzione

---

## 🔍 Refresh On-Demand (alla ricerca)

### CASO 1: Nessun evento trovato (0 risultati)

**Comportamento:** Refresh SINCRONO
```
User → Cerca "Lecco, gennaio 2026"
       ↓
GET /api/events?location=Lecco&dateFrom=2026-01-01
       ↓
Query DB → 0 risultati
       ↓
Triggera n8n workflow con parametri specifici
       ↓
Aspetta max 2 minuti
       ↓
Re-fetch dal DB
       ↓
Mostra risultati freschi (o "Nessun evento" se ancora vuoto)
```

**UX:** L'utente aspetta 1-2 minuti la prima volta che cerca quella combinazione

### CASO 2: Eventi trovati, cache vecchia (>4h)

**Comportamento:** Refresh ASINCRONO
```
User → Cerca "Milano"
       ↓
Query DB → 150 eventi trovati
       ↓
Check cache → Ultima esecuzione 5h fa (>4h)
       ↓
Mostra eventi IMMEDIATAMENTE al frontend
       ↓
In parallelo: triggera n8n in background (fire-and-forget)
       ↓
Prossima ricerca avrà dati aggiornati
```

**UX:** L'utente vede subito i risultati esistenti, la prossima volta avrà dati più freschi

### CASO 3: Eventi trovati, cache fresca (<4h)

**Comportamento:** Solo lettura DB
```
User → Cerca "Bergamo"
       ↓
Query DB → 80 eventi trovati
       ↓
Check cache → Ultima esecuzione 2h fa (<4h)
       ↓
Mostra eventi dal DB
       ↓
NO refresh triggered
```

**UX:** Velocissimo, <1 secondo

---

## 🐛 Bug Risolti

### Bug 1: Case-sensitivity città (OpenData)
**Problema:** `"Milano" !== "MILANO"` → tutti eventi scartati

**Fix:**
```javascript
// Prima
params.cities.includes(data.comune)

// Dopo
params.cities.some(city => city.toLowerCase() === data.comune?.toLowerCase())
```

### Bug 2: Filtro date troppo rigido (SoloSagre)
**Problema:** Eventi attivi venivano scartati se iniziavano prima del range

**Fix:**
```javascript
// Prima
if (eventDate < dateFrom || eventDate > dateTo) return null

// Dopo
const isActiveInPeriod = eventStartDate <= dateTo && eventEndDate >= dateFrom
```

---

## 📊 Cache System

### Tabella: `workflow_executions`
```sql
{
  id: number
  queryHash: string (hash SHA-256 dei parametri)
  status: 'pending' | 'running' | 'completed' | 'failed'
  lastExecutedAt: DateTime
  eventCount: number
  n8nExecutionId: string
  cities: string[]
  dateFrom: DateTime
  dateTo: DateTime
  ...
}
```

### TTL (Time To Live)
- **4 ore** - dopo questo tempo, i dati sono considerati "stale"
- Controllato tramite confronto timestamp

---

## 🧪 Testing

### Test Refresh Schedulato
```bash
# Verificare esecuzioni n8n ogni 4 ore
# Guardare i log n8n o il database workflow_executions
```

### Test Refresh On-Demand

#### Test CASO 1 (0 risultati → sincrono)
```bash
# Cerca una città/periodo mai cercato prima
curl "http://localhost:3000/api/events?location=Sondrio&dateFrom=2026-06-01"

# Dovrebbe:
# 1. Aspettare ~1-2 minuti
# 2. Vedere console log: "[Refresh On-Demand] No events found, triggering synchronous refresh..."
# 3. Ricevere risultati freschi
```

#### Test CASO 2 (>4h → asincrono)
```bash
# 1. Cancellare manualmente una cache entry vecchia o aspettare 4h
# 2. Cercare quella città
curl "http://localhost:3000/api/events?location=Milano"

# Dovrebbe:
# 1. Rispondere immediatamente con eventi esistenti
# 2. Vedere console log: "[Refresh On-Demand] Cache stale, triggering background refresh..."
```

#### Test CASO 3 (cache fresca → solo DB)
```bash
# Cercare subito dopo un refresh
curl "http://localhost:3000/api/events?location=Milano"

# Dovrebbe:
# 1. Rispondere velocissimo (<1s)
# 2. NO log di refresh
```

---

## 📝 Logs da Monitorare

### Backend (`/api/events`)
```
[Cache] Data age: 2.3h, Events: 450
[Refresh On-Demand] No events found, triggering synchronous refresh...
[Refresh On-Demand] Refresh completed, re-fetching events...
[Refresh On-Demand] Cache stale, triggering background refresh...
```

### n8n Workflow
```
Parse Query Parameters → Detecta source (scheduled vs webhook)
HTTP Request → Fetch dati dalle fonti
Transform → Filtri case-insensitive
Insert DB → Eventi salvati (upsert)
Update Cache → Status: completed
```

---

## 🚀 Deploy

### Prerequisiti
1. N8N_WEBHOOK_URL configurato in `.env`
2. N8N_WEBHOOK_SECRET configurato (opzionale ma raccomandato)
3. Database PostgreSQL con schema aggiornato
4. Workflow n8n "Fuorirotta - Multi-Source Scraper" attivo

### Checklist
- [ ] Workflow n8n è attivo (`active: true`)
- [ ] Schedule Trigger è abilitato
- [ ] Webhook trigger funziona
- [ ] Database ha tabella `workflow_executions`
- [ ] Variabili ambiente configurate

---

## 🔧 Troubleshooting

### "Workflow non parte mai"
- Controlla che il workflow sia attivo in n8n
- Verifica che Schedule Trigger sia enabled
- Guarda i log n8n per errori

### "Refresh on-demand non parte"
- Verifica N8N_WEBHOOK_URL in `.env`
- Controlla autenticazione webhook
- Guarda console backend per errori

### "Eventi duplicati"
- Il workflow usa UPSERT (ON CONFLICT UPDATE)
- Verifica che `source` + `source_id` siano unici

### "Tutti gli eventi vengono scartati"
- Controlla i log del nodo "Transform"
- Verifica che le città siano matchate (case-insensitive ora)
- Verifica che le date siano nel range

---

## 📈 Metriche da Monitorare

1. **Refresh schedulati:** 6 al giorno (ogni 4h)
2. **Refresh on-demand:** Dipende dalle ricerche utenti
3. **Tempo medio refresh:** 1-3 minuti
4. **Eventi nel DB:** ~500-1000 (dipende da quanti ne trovano le fonti)
5. **Cache hit rate:** Idealmente >80% dopo prime 4 ore

---

## 🎯 Best Practices

1. **Non disabilitare Schedule Trigger** - è la fonte primaria di dati freschi
2. **Monitorare errori n8n** - fix subito se il workflow fallisce
3. **Non modificare query_hash** - romperebbe il sistema di cache
4. **Backup database** - specialmente tabella `events`
5. **Rate limiting** - considera limiti API delle fonti esterne

---

## 🔮 Possibili Miglioramenti Futuri

1. **Notifiche admin:** Email quando refresh fallisce
2. **Dashboard metriche:** Visualizzare cache hit/miss rate
3. **Refresh selettivo:** Solo città specifiche invece di tutte
4. **Retry automatico:** Se un refresh fallisce, riprova dopo N minuti
5. **Webhooks inversi:** n8n notifica frontend quando ha nuovi dati
