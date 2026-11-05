-- Migrazione ADDITIVA (Fase 27.1): solo CREATE TABLE, CREATE INDEX e FOREIGN KEY
-- sulla tabella nuova visited_events. Non tocca nessuna tabella esistente: n8n
-- condivide il database Supabase di produzione.
-- La FK verso auth_user cancella a cascata; quella verso events e' SET NULL,
-- cosi' il purge dei 7 giorni lascia l'istantanea della visita.

-- CreateTable
CREATE TABLE "visited_events" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_id" INTEGER,
    "title" VARCHAR(500) NOT NULL,
    "date_start" TIMESTAMP(6) NOT NULL,
    "date_end" TIMESTAMP(6),
    "place" VARCHAR(255),
    "canonical_category" VARCHAR(50) NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "source_id" VARCHAR(255) NOT NULL,
    "source_url" VARCHAR(1000),
    "visit_day" DATE NOT NULL,
    "visited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visited_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visited_events_event_id_idx" ON "visited_events"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "visited_events_user_id_source_source_id_key" ON "visited_events"("user_id", "source", "source_id");

-- AddForeignKey
ALTER TABLE "visited_events" ADD CONSTRAINT "visited_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visited_events" ADD CONSTRAINT "visited_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

