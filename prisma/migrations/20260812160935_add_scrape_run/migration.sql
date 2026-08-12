-- CreateTable
CREATE TABLE "scrape_runs" (
    "id" SERIAL NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "region" VARCHAR(50) NOT NULL,
    "started_at" TIMESTAMP(6) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "event_count" INTEGER NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrape_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_scrape_runs_source_region_started" ON "scrape_runs"("source", "region", "started_at");
