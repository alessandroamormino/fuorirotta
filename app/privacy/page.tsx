import type { Metadata } from "next";
import Link from "next/link";
import { FactList, LegalPage } from "@/components/legal/LegalPage";

// Pagina statica: nessuna lettura della richiesta (niente cookies(), headers()
// o searchParams) e nessun componente client, cosi' resta ○ nella build e
// pubblica con l'interruttore dell'accesso spento (D-14, D-16).
// Testo da 21-PRIVACY-TEXT.md; i numeri di conservazione sono vincolati al codice
// da check:privacy-pages.

export const metadata: Metadata = {
	title: "Informativa sulla privacy",
	description:
		"Quali dati personali tratta Fuorirotta, perché, con quali fornitori, per quanto tempo e come esercitare i tuoi diritti.",
};

const UPDATED = "18 ottobre 2026";

const INDEX = [
	{ id: "titolare", label: "Titolare del trattamento" },
	{ id: "dati", label: "Quali dati trattiamo" },
	{ id: "finalita", label: "Finalità e basi giuridiche" },
	{ id: "destinatari", label: "Destinatari e responsabili del trattamento" },
	{ id: "conservazione", label: "Conservazione" },
	{ id: "diritti", label: "I tuoi diritti" },
	{ id: "cookie", label: "Cookie" },
	{ id: "comunicazioni", label: "Comunicazioni" },
	{ id: "eta", label: "Età minima" },
	{ id: "modifiche", label: "Modifiche" },
];

export default function PrivacyPage() {
	return (
		<LegalPage title="Informativa sulla privacy" updated={UPDATED} index={INDEX}>
			<p>
				Questa informativa spiega quali dati personali tratta Fuorirotta (fuori-rotta.it e, quando uscirà, la
				sua app) e perché. Vale per chi crea un account; chi si limita a consultare gli eventi non deve
				registrarsi e per questo non ci lascia alcun dato di account. Senza account puoi anche salvare eventi
				nel browser: di quell&apos;elenco non conserviamo nulla sul nostro server.
			</p>

			<h2 id="titolare">Titolare del trattamento</h2>
			<p>Il titolare del trattamento è Alessandro Amormino, persona fisica.</p>
			<p>
				Per qualsiasi richiesta sui tuoi dati scrivi a:{" "}
				<a href="mailto:amormino.alessandro97@gmail.com">amormino.alessandro97@gmail.com</a>
			</p>
			<p>L&apos;indirizzo postale del titolare non è indicato.</p>

			<h2 id="dati">Quali dati trattiamo</h2>
			<p>Se crei un account:</p>
			<ul>
				<li>
					<strong>Dati dell&apos;account</strong>, ricevuti da Google quando accedi: nome, indirizzo email e
					l&apos;identificativo che Google assegna al tuo account. Non riceviamo e non conserviamo la tua
					password: l&apos;accesso avviene solo tramite Google. Non conserviamo i codici di accesso (token)
					che Google ci restituisce. Salviamo anche l&apos;indirizzo (URL) della tua foto del profilo di
					Google, che aggiorniamo a ogni accesso, per mostrarla come tua immagine nell&apos;app; se manca o
					non si carica, mostriamo la tua iniziale. Non copiamo la foto sui nostri server: quando viene
					mostrata, il tuo browser la scarica direttamente dai server di Google, che vedono il tuo indirizzo
					IP.
				</li>
				<li>
					<strong>Sessioni attive</strong>: per ogni accesso conserviamo l&apos;indirizzo IP, il tipo di
					browser, il momento in cui la sessione è stata creata, l&apos;ultimo rinnovo e la scadenza. Servono
					a mostrarti l&apos;elenco dei dispositivi collegati (senza l&apos;indirizzo IP) e a permetterti di
					chiuderli.
				</li>
				<li>
					<strong>Sicurezza</strong>: l&apos;indirizzo IP viene usato anche per limitare i tentativi di
					accesso ripetuti (rate limiting) e resta registrato per questo scopo per 24 ore.
				</li>
				<li>
					<strong>Eventi salvati</strong>: quando tocchi il cuore su un evento conserviamo quale evento hai
					salvato, la data in cui l&apos;hai salvato e una copia di titolo, date, comune, categoria, fonte e
					link alla fonte. La copia serve a mostrarti l&apos;evento in &quot;Passati&quot; anche dopo che esce
					dal nostro catalogo.
				</li>
				<li>
					<strong>Collegamento al calendario</strong>: se lo crei, è un collegamento segreto, generato a caso,
					che mostra i tuoi eventi salvati a chiunque lo abbia. Non condividerlo.
				</li>
			</ul>
			<p>Anche senza account, quando usi il sito:</p>
			<ul>
				<li>
					Il server riceve l&apos;indirizzo IP e il tipo di browser di ogni richiesta, come ogni sito web.
					Questi dati finiscono nei log di accesso di nginx, il programma che riceve le richieste prima della
					nostra applicazione. Quanto restano conservati lo trovi nella sezione &quot;Conservazione&quot;.
				</li>
				<li>
					Se usi la ricerca per distanza (&quot;vicino a me&quot;), il browser ti chiede il permesso di
					conoscere la tua posizione e, solo quando lo chiedi tu, invia le coordinate al nostro server per
					filtrare gli eventi. L&apos;applicazione non le scrive nei propri log e non le salva nel database in
					chiaro (la memoria temporanea delle ricerche conserva soltanto un&apos;impronta crittografica dei
					parametri di ricerca, da cui le coordinate non si leggono). Le coordinate fanno parte
					dell&apos;indirizzo richiesto, quindi compaiono nei log di accesso di nginx per il tempo indicato
					nella sezione &quot;Conservazione&quot;.
				</li>
				<li>
					Se salvi eventi senza account, l&apos;elenco resta nella memoria del tuo browser. Per
					mostrartelo il sito invia al nostro server i numeri degli eventi, solo per leggerne i dati
					aggiornati: il server non li conserva. Quando accedi, l&apos;elenco viene aggiunto al tuo account e
					tolto dal browser.
				</li>
				<li>
					Il sito ricorda alcune tue scelte (tema chiaro o scuro, filtri di ricerca, avvisi già mostrati)
					nella memoria del tuo browser. Restano sul tuo dispositivo e non vengono mai inviate al nostro
					server.
				</li>
			</ul>

			<h2 id="finalita">Finalità e basi giuridiche</h2>
			<FactList
				items={[
					{
						title: "Account e funzioni",
						facts: [
							[
								"Finalità",
								"Fornirti l'account e le sue funzioni: accesso, elenco dei dispositivi, modifica del nome, eventi salvati e collegamento al calendario, scarico ed eliminazione dei tuoi dati",
							],
							["Base giuridica", "esecuzione del contratto, art. 6.1.b GDPR"],
						],
					},
					{
						title: "Sicurezza",
						facts: [
							[
								"Finalità",
								"Sicurezza del servizio e prevenzione degli abusi, compreso il limite ai tentativi di accesso e i log di accesso del server",
							],
							["Base giuridica", "legittimo interesse del titolare, art. 6.1.f GDPR"],
						],
					},
				]}
			/>
			<p>Non facciamo profilazione, non usiamo i tuoi dati per pubblicità e non li vendiamo.</p>

			<h2 id="destinatari">Destinatari e responsabili del trattamento</h2>
			<p>Per far funzionare il servizio ci affidiamo a:</p>
			<FactList
				items={[
					{
						title: "Supabase",
						facts: [
							["Ruolo", "Ospita il database ed è nostro responsabile del trattamento."],
							["Dove", "I dati sono in regione eu-west-1 (Irlanda), nell'Unione europea."],
							[
								"Garanzie",
								"L'accordo sul trattamento dei dati (DPA) fa parte dei Termini di servizio di Supabase e vale per noi senza ulteriori firme. Supabase può avvalersi di sub-responsabili anche fuori dall'Unione europea; per questi trasferimenti il suo DPA incorpora le clausole contrattuali standard della Commissione europea (decisione (UE) 2021/914) e stabilisce che l'accettazione dei Termini ha lo stesso effetto della loro firma.",
							],
						],
					},
					{
						title: "Hetzner Online GmbH",
						facts: [
							["Ruolo", "Ospita il server su cui gira Fuorirotta."],
							["Dove", "Il server si trova a Norimberga, in Germania (Unione europea)."],
							["Garanzie", "Con Hetzner abbiamo concluso l'accordo sul trattamento dei dati."],
							[
								"Copie di sicurezza",
								"Le copie di sicurezza cifrate del database vengono create ogni giorno su questo stesso server.",
							],
						],
					},
					{
						title: "Mapbox Inc.",
						facts: [
							[
								"Ruolo",
								"Società statunitense, fornisce le mappe: per mostrarle il tuo browser contatta direttamente i server di Mapbox, che vedono il tuo indirizzo IP e le porzioni di mappa che richiedi.",
							],
							[
								"Garanzie",
								"Il trasferimento verso gli Stati Uniti si basa, secondo l'informativa di Mapbox, sulla sua certificazione al EU-US Data Privacy Framework (la decisione di adeguatezza della Commissione europea) e, dove necessario, sulle clausole contrattuali standard.",
							],
						],
					},
					{
						title: "Immagini degli eventi",
						facts: [
							[
								"Ruolo",
								"Molte immagini sono caricate direttamente dal sito dell'organizzatore o della fonte che ha pubblicato l'evento; il tuo browser contatta quei siti, che possono vedere il tuo indirizzo IP. Non possiamo controllare i loro trattamenti.",
							],
						],
					},
					{
						title: "Il calendario che scegli",
						facts: [
							[
								"Ruolo",
								"Se ti iscrivi al collegamento con un servizio di calendario a tua scelta (per esempio Google Calendar), quel servizio riceve il collegamento e legge dal nostro server l'elenco dei tuoi eventi salvati per mostrartelo. Opera come titolare autonomo del trattamento secondo la propria informativa.",
							],
						],
					},
					{
						title: "Google",
						facts: [
							[
								"Ruolo",
								"Quando scegli di accedere con il suo servizio, opera come titolare autonomo del trattamento secondo la propria informativa. Noi riceviamo da Google solo i dati elencati sopra.",
							],
							[
								"Foto del profilo",
								"Google riceve inoltre il tuo indirizzo IP ogni volta che il tuo browser carica la tua foto del profilo mostrata nell'app (la richiesta non porta con sé l'indirizzo della pagina da cui parte).",
							],
						],
					},
				]}
			/>
			<p>
				Non comunichiamo i tuoi dati ad altri soggetti, salvo obblighi di legge. Non inviamo email: nessun
				fornitore di posta riceve i tuoi dati. La libreria che gestisce l&apos;accesso non invia dati di
				telemetria a terzi.
			</p>

			<h2 id="conservazione">Conservazione</h2>
			<FactList
				items={[
					{
						title: "Dati dell'account",
						facts: [
							[
								"Quanto",
								"Fino a quando non elimini l'account. L'eliminazione è immediata e totale: cancella i tuoi dati (compreso l'indirizzo della foto del profilo), le sessioni, gli eventi salvati, il collegamento al calendario e il collegamento con Google.",
							],
						],
					},
					{
						title: "Eventi salvati",
						facts: [
							[
								"Quanto",
								"Fino a quando non li togli tu o non elimini l'account. Un evento salvato che è finito resta ancora 12 mesi dopo la sua fine, poi lo cancella il controllo giornaliero. Gli stessi 12 mesi valgono per l'elenco conservato nel browser.",
							],
						],
					},
					{
						title: "Collegamento al calendario",
						facts: [
							[
								"Quanto",
								"Fino a quando non lo rigeneri con \"Rigenera link\" (il vecchio collegamento smette di funzionare subito) o non elimini l'account. Come ogni indirizzo richiesto, il collegamento compare nei log di accesso di nginx per circa 14 giorni.",
							],
						],
					},
					{
						title: "Sessioni",
						facts: [
							[
								"Quanto",
								"60 giorni, rinnovati a ogni giorno in cui usi il sito da quel dispositivo, oppure fino a quando le chiudi tu. Le sessioni scadute e i dati temporanei dell'accesso vengono rimossi ogni giorno.",
							],
						],
					},
					{
						title: "Indirizzi IP dei tentativi di accesso",
						facts: [["Quanto", "24 ore."]],
					},
					{
						title: "Copie di sicurezza (backup)",
						facts: [
							[
								"Quanto",
								"Ogni giorno facciamo una copia cifrata del database sul server e la copiamo su un dispositivo di archiviazione del titolare (in casa, in Italia), non accessibile da internet. Ogni copia è leggibile solo con una chiave in possesso esclusivo del titolare e la teniamo per 14 giorni, poi la cancelliamo. Se elimini l'account, i tuoi dati scompaiono subito dal database ma possono restare nelle copie di sicurezza già fatte fino a 14 giorni; poi scompaiono anche da lì. Le copie non vengono riutilizzate per altri scopi.",
							],
						],
					},
					{
						title: "Log di accesso del server (nginx)",
						facts: [
							[
								"Quanto",
								"Indirizzo IP, tipo di browser e indirizzo richiesto (comprese le coordinate di una ricerca \"vicino a me\" e il collegamento al calendario) sono conservati per circa 14 giorni, poi i log più vecchi vengono sovrascritti.",
							],
						],
					},
				]}
			/>

			<h2 id="diritti">I tuoi diritti</h2>
			<p>Puoi chiedere in ogni momento:</p>
			<ul>
				<li>
					l&apos;<strong>accesso</strong> ai tuoi dati;
				</li>
				<li>
					la <strong>rettifica</strong> dei dati inesatti (il nome visualizzato lo modifichi tu dal profilo);
				</li>
				<li>
					la <strong>cancellazione</strong>: la fai tu stesso dal sito, è immediata;
				</li>
				<li>
					la <strong>portabilità</strong>: scarichi tutti i tuoi dati in formato JSON dal sito;
				</li>
				<li>
					l&apos;<strong>opposizione</strong> ai trattamenti basati sul legittimo interesse, e la{" "}
					<strong>limitazione</strong> del trattamento.
				</li>
			</ul>
			<p>
				Per esercitarli, oltre agli strumenti nel tuo account, scrivi all&apos;indirizzo del titolare indicato
				sopra. Hai anche il diritto di proporre reclamo al{" "}
				<strong>Garante per la protezione dei dati personali</strong> (
				<a href="https://www.garanteprivacy.it">www.garanteprivacy.it</a>).
			</p>

			<h2 id="cookie">Cookie</h2>
			<p>
				Vedi la pagina <Link href="/cookie">Cookie</Link>.
			</p>

			<h2 id="comunicazioni">Comunicazioni</h2>
			<p>Fuorirotta non invia email.</p>

			<h2 id="eta">Età minima</h2>
			<p>
				Per creare un account devi avere almeno 14 anni, l&apos;età minima per prestare il consenso ai servizi
				della società dell&apos;informazione in Italia (art. 2-quinquies del Codice in materia di protezione
				dei dati personali). È anche l&apos;età minima che Google richiede in Italia per avere un proprio
				account. Alla registrazione non facciamo controlli ulteriori rispetto a quelli di Google.
			</p>

			<h2 id="modifiche">Modifiche</h2>
			<p>
				Se questa informativa cambia, aggiorniamo la data in cima e, se la modifica è rilevante, te lo
				segnaliamo sul sito.
			</p>
		</LegalPage>
	);
}
