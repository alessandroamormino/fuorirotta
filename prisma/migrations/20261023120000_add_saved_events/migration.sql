-- Migrazione ADDITIVA (Fase 22): solo CREATE TABLE, CREATE INDEX e FOREIGN KEY
-- sulle due tabelle nuove, saved_events e calendar_feeds. Non tocca nessuna
-- tabella esistente: n8n condivide il database Supabase di produzione.
-- Le FK verso auth_user cancellano a cascata; quella verso events e' SET NULL,
-- cosi' il purge dei 7 giorni lascia l'istantanea del salvato (D1).

-- CreateTable
CREATE TABLE "saved_events" (
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
    "saved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_feeds" (
    "user_id" TEXT NOT NULL,
    "token" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMPTZ(6),

    CONSTRAINT "calendar_feeds_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "saved_events_event_id_idx" ON "saved_events"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_events_user_id_source_source_id_key" ON "saved_events"("user_id", "source", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_feeds_token_key" ON "calendar_feeds"("token");

-- AddForeignKey
ALTER TABLE "saved_events" ADD CONSTRAINT "saved_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_events" ADD CONSTRAINT "saved_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

