import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { getComposedEvent } from "@/lib/events/getComposedEvent";
import { todayInRome } from "@/lib/dateWindow";
import { OG_BRAND } from "@/lib/og/brand";
import { OgCard, ogCardContent } from "@/lib/og/card";

const TEXT = "text/plain; charset=utf-8";

// Bricolage Grotesque Regular e Bold (TTF statici, repo ateliertriay/bricolage) (public/fonts, licenza OFL accanto).
// Non dipendono dalla richiesta: si leggono una volta sola, alla prima richiesta
// e dentro il try del GET (un top-level await farebbe fallire l'import del
// modulo, fuori dal catch e dal 500 pensato). Se la lettura fallisce la promise
// non resta in cache: la richiesta dopo riprova.
const fontFile = (name: string) => readFile(join(process.cwd(), "public", "fonts", name));
let fonts: Promise<[Buffer, Buffer]> | null = null;
const loadFonts = () => (fonts ??= Promise.all([fontFile("BricolageGrotesque-Regular.ttf"), fontFile("BricolageGrotesque-Bold.ttf")]));

// La card Open Graph degli eventi senza immagine (SHARE-01). Sta fuori da
// /api/ perche' robots.txt lo vieta ai crawler. Anonima: non legge cookie ne'
// header della richiesta, e non tocca mai l'immagine della fonte (T-20-20):
// le immagini della fonte restano solo URL nei metadati.
//
// ponytail: nessuna cache lato server (niente nginx davanti, revalidate su un
// route handler dinamico non verificato: RESEARCH A4). Un giorno di cache
// pubblica sul client/CDN. Se il carico di render si vede, nginx proxy_cache
// su /eventi/*/og.
export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;
		const notFound = () => new Response("Evento non trovato", { status: 404, headers: { "content-type": TEXT } });
		// Solo cifre, al massimo nove: nulla di strano arriva a Prisma (T-20-19).
		if (!/^\d{1,9}$/.test(id)) return notFound();

		const result = await getComposedEvent(Number(id));
		if (result.status !== "ok") return notFound();

		const [bricolageRegular, bricolageBold] = await loadFonts();
		return new ImageResponse(OgCard(ogCardContent(result.event, todayInRome())), {
			width: 1200,
			height: 630,
			fonts: [
				{ name: OG_BRAND.fontFamily, data: bricolageRegular, style: "normal", weight: 400 },
				{ name: OG_BRAND.fontFamily, data: bricolageBold, style: "normal", weight: 700 },
			],
			// Minuscolo come la chiave di ImageResponse: con altre maiuscole il
			// costruttore di Headers accoderebbe i due valori. Un giorno, non il
			// "immutable" di un anno di default (T-20-23).
			headers: { 'cache-control': 'public, max-age=86400' },
		});
	} catch (error) {
		fonts = null;
		console.error("Error rendering og card:", error);
		return new Response("Errore interno", { status: 500, headers: { "content-type": TEXT } });
	}
}
