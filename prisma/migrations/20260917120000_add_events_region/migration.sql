-- AlterTable
ALTER TABLE "events" ADD COLUMN     "region" VARCHAR(50);

-- CreateIndex
CREATE INDEX "idx_events_region_date_start" ON "events"("region", "date_start");
