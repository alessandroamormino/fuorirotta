-- Migrazione ADDITIVA (Fase 23): solo CREATE TABLE, CREATE INDEX e FOREIGN KEY
-- sulle due tabelle nuove, user_follows e user_preferences. Non tocca nessuna
-- tabella esistente: n8n condivide il database Supabase di produzione.
-- Le FK verso auth_user cancellano a cascata.

-- CreateTable
CREATE TABLE "user_follows" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" TEXT NOT NULL,
    "onboarded_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_follows_user_id_kind_key_key" ON "user_follows"("user_id", "kind", "key");

-- AddForeignKey
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

