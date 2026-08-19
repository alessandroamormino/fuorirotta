// Contenuto redazionale delle destinazioni suggerite della Navbar (D-06).
// Origine: Decisione D-17 (Fase 6, 06-04-PLAN.md) aveva gia' isolato questa
// lista come la terza copia delle stesse dodici città lombarde che vivevano
// anche nel filtro API e nel fallback mappa — ma, a differenza di quelle,
// non è un lookup territoriale: non porta coordinate e non risolve nulla.
// Porta sottotitolo e icona, contenuto redazionale ("Città alta", "Città dei
// violini") che la tabella `Comune` non modella, quindi non è sostituibile
// uno-a-uno da una query. Le altre due liste sono state eliminate in Fase 6
// (TERR-06); questa resta, con una casa dichiarata fuori dal componente.
//
// Copertura: oggi solo lombarda (12 capoluoghi + "Nelle vicinanze"). Si
// estende quando il bacino eventi si estende oltre la Lombardia (Fase 15).
//
// Nota per 09-05 (D-19, deciso il 2026-08-19): il pannello "Dove" desktop
// diventerà unificato — i preset qui sotto lasciano il posto ai risultati
// dell'autocomplete nello stesso contenitore quando si digita. Questo modulo
// non decide da solo quale lista sia attiva: quella scelta vive nell'hook
// condiviso (`useNavbarSearch`), derivata da un'unica sorgente di verità
// (se il campo di ricerca è vuoto), non da due stati indipendenti.

export interface SuggestedDestination {
	name: string;
	subtitle: string;
	icon: string;
	istatCode: string | null;
	isNearby?: boolean;
}

export const SUGGESTED_DESTINATIONS: SuggestedDestination[] = [
	{
		name: "Nelle vicinanze",
		subtitle: "Destinazioni vicine a te",
		icon: "nearby",
		istatCode: null,
		isNearby: true,
	},
	{ name: "Milano", subtitle: "Capitale lombarda", icon: "city", istatCode: '015146' },
	{ name: "Bergamo", subtitle: "Città alta", icon: "castle", istatCode: '016024' },
	{ name: "Brescia", subtitle: "Leonessa d'Italia", icon: "monument", istatCode: '017029' },
	{ name: "Como", subtitle: "Città dei laghi", icon: "lake", istatCode: '013075' },
	{ name: "Cremona", subtitle: "Città dei violini", icon: "music", istatCode: '019036' },
	{ name: "Lecco", subtitle: "Tra lago e montagne", icon: "mountain", istatCode: '097042' },
	{ name: "Lodi", subtitle: "Città storica", icon: "castle", istatCode: '098031' },
	{ name: "Mantova", subtitle: "Città d'arte", icon: "monument", istatCode: '020030' },
	{ name: "Monza", subtitle: "Città della corona", icon: "city", istatCode: '108033' },
	{ name: "Pavia", subtitle: "Università storica", icon: "monument", istatCode: '018110' },
	{ name: "Sondrio", subtitle: "Porta della Valtellina", icon: "mountain", istatCode: '014061' },
	{ name: "Varese", subtitle: "Città giardino", icon: "lake", istatCode: '012133' },
];

export const DEST_PREVIEW_COUNT = 3;

export const RADIUS_OPTIONS = [
	{ value: 10, label: "10 km", subtitle: "Vicinissimo" },
	{ value: 20, label: "20 km", subtitle: "Nelle vicinanze" },
	{ value: 50, label: "50 km", subtitle: "Zona estesa" },
];
