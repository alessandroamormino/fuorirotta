import { prisma } from "@/lib/prisma";

// Fase 27.2.1 (egress): la tabella `comuni` (7.894 righe) cambia solo col seed,
// ma tre punti la rileggevano intera a ogni richiesta (ogni lettera digitata in
// una ricerca): voce n. 2 dell'egress Supabase. Una lettura per processo; il
// deploy riavvia il processo. Su errore la promessa si azzera e si riprova.
// ponytail: nessuna invalidazione; se i comuni diventano modificabili a caldo, TTL qui.
function once<T>(load: () => Promise<T>): () => Promise<T> {
	let p: Promise<T> | undefined;
	return () =>
		(p ??= load().catch((err) => {
			p = undefined;
			throw err;
		}));
}

export const allComuni = once(() =>
	prisma.comune.findMany({
		select: {
			id: true,
			istatCode: true,
			name: true,
			aliases: true,
			provinceCode: true,
			provinceName: true,
			regionName: true,
			latitude: true,
			longitude: true,
		},
		orderBy: { id: "asc" },
	})
);
