-- Estensione pg_trgm per il gradino fuzzy del matching (10-03): dichiarata qui
-- e non nello schema.prisma, perche' dichiararla nello schema fa si' che ogni
-- `prisma migrate dev`/`db push` successivo provi a droppare e ricreare gli
-- oggetti dell'estensione (issue Prisma #16275).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "canonical_event_id" INTEGER,
ADD COLUMN     "merge_reason" VARCHAR(255),
ADD COLUMN     "merge_score" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "events_canonical_event_id_idx" ON "events"("canonical_event_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_canonical_event_id_fkey" FOREIGN KEY ("canonical_event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
