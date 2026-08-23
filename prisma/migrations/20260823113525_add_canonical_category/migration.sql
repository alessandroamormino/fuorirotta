-- AlterTable
ALTER TABLE "events" ADD COLUMN     "canonical_category" VARCHAR(50) NOT NULL DEFAULT 'Altro';

-- CreateIndex
CREATE INDEX "idx_events_canonical_category" ON "events"("canonical_category");

