import type { Metadata } from "next";
import { FactList, LegalPage } from "@/components/legal/LegalPage";

// Pagina statica: nessuna lettura della richiesta e nessun componente client
// (D-14, D-16). I cookie elencati sono quelli che il sign-in imposta davvero,
// registrati dal gate di 21-03 (nomi di produzione, con prefisso __Secure-);
// se un aggiornamento di Better Auth ne aggiunge uno, questa lista lo segue.

export const metadata: Metadata = {
	title: "Informativa sui cookie",
	description:
		"Quali cookie usa Fuorirotta: solo cookie tecnici necessari all'accesso, nessun cookie di profilazione o di terze parti.",
};

const UPDATED = "24 ottobre 2026";

export default function CookiePage() {
	return (
		<LegalPage title="Informativa sui cookie" updated={UPDATED}>
			<p>{"Non usiamo cookie di profilazione né di terze parti, quindi non c'è nessun banner."}</p>

			<h2 id="cookie-che-usiamo">Cookie che usiamo</h2>
			<p>Usiamo due cookie, entrambi tecnici e necessari, e solo se accedi:</p>
			<FactList
				items={[
					{
						title: "Cookie di sessione",
						facts: [
							["Nome", <code key="n">__Secure-fuorirotta.session_token</code>],
							["A cosa serve", "Ti tiene collegato dopo l'accesso con Google."],
							["Durata", "60 giorni, rinnovati con l'uso."],
							[
								"Tipo",
								"Tecnico, necessario. Non si può rifiutare perché senza di esso l'accesso non funziona; chi non accede non lo riceve.",
							],
						],
					},
					{
						title: "Cookie del passaggio da Google",
						facts: [
							["Nome", <code key="n">__Secure-fuorirotta.state</code>],
							[
								"A cosa serve",
								"Protegge il passaggio da Google: serve a verificare che chi torna da Google sia chi ha avviato l'accesso.",
							],
							["Durata", "5 minuti, solo durante il passaggio da Google; viene cancellato al ritorno sul sito."],
							[
								"Tipo",
								"Tecnico, necessario. Non si può rifiutare perché senza di esso l'accesso non funziona; chi non accede non lo riceve.",
							],
						],
					},
				]}
			/>

			<h2 id="memoria-del-browser">Memoria del browser</h2>
			<p>
				Il sito salva alcune scelte nella memoria del tuo browser: il tema chiaro o scuro (localStorage),
				l&apos;elenco degli eventi salvati senza account (localStorage), un segnale che ricorda se hai dei luoghi o
				delle categorie seguiti (localStorage) e, per la sola scheda aperta, i filtri di ricerca, gli avvisi
				già mostrati e il luogo che stavi per seguire mentre accedi (sessionStorage).
			</p>
			<p>
				L&apos;elenco degli eventi salvati contiene fino a 100 eventi; ogni voce si cancella da sola 12 mesi
				dopo la fine dell&apos;evento. Per mostrartelo il sito invia al nostro server i numeri degli eventi,
				solo per leggerne i dati aggiornati: il server non li conserva. L&apos;elenco si svuota quando viene
				aggiunto al tuo account, all&apos;accesso, e quando esci. Le altre scelte (tema, filtri, avvisi
				mostrati) restano sul tuo dispositivo e non vengono mai inviate al nostro server.
			</p>

			<FactList
				items={[
					{
						title: "Segnale di Per te",
						facts: [
							["Nome", <code key="n">fuorirotta.perte</code>],
							["Dove", "localStorage"],
							[
								"A cosa serve",
								"Ricorda su questo dispositivo che hai dei luoghi o delle categorie seguiti, così «Per te» compare senza far saltare la pagina. Non contiene dati personali.",
							],
							["Durata", "Fino a quando esci dall'account."],
						],
					},
					{
						title: "Luogo che stavi per seguire",
						facts: [
							["Nome", <code key="n">fuorirotta.follow-intent</code>],
							["Dove", "sessionStorage"],
							[
								"A cosa serve",
								"Tiene a mente il luogo che stavi per seguire mentre accedi. Si cancella da solo dopo 15 minuti o alla chiusura della scheda.",
							],
							["Durata", "15 minuti al massimo; si toglie anche quando esci dall'account."],
						],
					},
				]}
			/>

			<h2 id="strumenti-di-terzi">Strumenti di terzi</h2>
			<p>
				Non usiamo strumenti di analisi o di tracciamento. I link per condividere un evento sono semplici
				indirizzi, senza parametri di tracciamento. Per l&apos;accesso con Google non carichiamo script di
				Google nelle nostre pagine: ti inviamo alla pagina di Google e torni da noi.
			</p>
		</LegalPage>
	);
}
