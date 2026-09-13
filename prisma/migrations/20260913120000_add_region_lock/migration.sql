-- CreateTable
CREATE TABLE "region_locks" (
    "region" VARCHAR(50) NOT NULL,
    "locked_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "region_locks_pkey" PRIMARY KEY ("region")
);

