-- AlterTable
ALTER TABLE "events" ADD COLUMN     "comune_id" INTEGER,
ADD COLUMN     "coordinate_source" VARCHAR(20),
ADD COLUMN     "resolved_latitude" DECIMAL(10,8),
ADD COLUMN     "resolved_longitude" DECIMAL(11,8);

-- CreateTable
CREATE TABLE "comuni" (
    "id" SERIAL NOT NULL,
    "istat_code" VARCHAR(6) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "province_code" VARCHAR(10) NOT NULL,
    "province_name" VARCHAR(255) NOT NULL,
    "region_code" VARCHAR(10) NOT NULL,
    "region_name" VARCHAR(255) NOT NULL,
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comuni_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comuni_istat_code_key" ON "comuni"("istat_code");

-- CreateIndex
CREATE INDEX "comuni_aliases_idx" ON "comuni" USING GIN ("aliases");

-- CreateIndex
CREATE INDEX "events_comune_id_idx" ON "events"("comune_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_comune_id_fkey" FOREIGN KEY ("comune_id") REFERENCES "comuni"("id") ON DELETE SET NULL ON UPDATE CASCADE;

