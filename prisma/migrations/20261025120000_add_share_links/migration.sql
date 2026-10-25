-- Migrazione ADDITIVA (Fase 24): solo CREATE TABLE, CREATE UNIQUE INDEX e FOREIGN KEY sulla tabella nuova share_links. Non tocca nessuna tabella esistente: n8n condivide il database Supabase di produzione. La FK verso auth_user cancella a cascata.

-- CreateTable
CREATE TABLE "share_links" (
    "user_id" TEXT NOT NULL,
    "token" VARCHAR(32) NOT NULL,
    "show_name" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMPTZ(6),

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links"("token");

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
