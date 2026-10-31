-- Migrazione ADDITIVA (Fase 26): solo CREATE TABLE, indici e FOREIGN KEY sulla tabella nuova push_devices. Non tocca nessuna tabella esistente: n8n condivide il database Supabase di produzione. Le FK verso auth_user e auth_session cancellano a cascata.

-- CreateTable
CREATE TABLE "push_devices" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "device_token" VARCHAR(200) NOT NULL,
    "environment" VARCHAR(10) NOT NULL,
    "app_version" VARCHAR(20),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_device_token_key" ON "push_devices"("device_token");

-- CreateIndex
CREATE INDEX "push_devices_user_id_idx" ON "push_devices"("user_id");

-- CreateIndex
CREATE INDEX "push_devices_session_id_idx" ON "push_devices"("session_id");

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

