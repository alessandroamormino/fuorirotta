-- CreateTable workflow_executions (versione semplificata - solo cache)
CREATE TABLE "workflow_executions" (
    "id" SERIAL NOT NULL,
    "query_hash" VARCHAR(64) NOT NULL,
    "location" VARCHAR(255),
    "radius_km" INTEGER,
    "date_from" DATE,
    "date_to" DATE,
    "cities" TEXT[],
    "last_executed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "n8n_execution_id" VARCHAR(255),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_executions_query_hash_key" ON "workflow_executions"("query_hash");

-- CreateIndex
CREATE INDEX "workflow_executions_query_hash_idx" ON "workflow_executions"("query_hash");

-- CreateIndex
CREATE INDEX "workflow_executions_last_executed_at_idx" ON "workflow_executions"("last_executed_at");

-- CreateIndex
CREATE INDEX "workflow_executions_status_idx" ON "workflow_executions"("status");

-- Comments
COMMENT ON TABLE "workflow_executions" IS 'Cache n8n workflows con TTL 4 ore';
COMMENT ON COLUMN "workflow_executions"."query_hash" IS 'SHA-256 hash di città+raggio+periodo normalizzati';
