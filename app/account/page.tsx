import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { appleEnabled, authEnabled, getAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import Card from "@/components/ui/Card";
import ProfileCard from "@/components/account/ProfileCard";
import FollowManager from "@/components/follow/FollowManager";
import SessionsList from "@/components/account/SessionsList";
import SignInMethods from "@/components/account/SignInMethods";
import StatsSection, { type Periodo, type Vista } from "@/components/account/StatsSection";
import { DeleteAccountSection, ExportButton, SignOutButton } from "@/components/account/AccountActions";
import { activityLabel, listUserSessions } from "@/lib/account";
import { todayInRome } from "@/lib/dateWindow";
import { isAppleRelayEmail } from "@/lib/displayName";
import { googleProfileImage } from "@/lib/profileImage";
import { computeStats, computeVisitedStats, defaultStatsYear, statsTiles } from "@/lib/stats/compute";

// Dinamica per costruzione: legge la sessione, quindi non puo' mai finire in
// una cache condivisa. Nessun'altra pagina importa il codice di questa (D-06).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Il tuo account",
	robots: { index: false },
};

const SECTION_TITLE = "mb-4 text-lg font-medium leading-[1.2] text-foreground";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
	// Interruttore spento: la pagina non esiste (D-16).
	if (!authEnabled()) notFound();
	const session = await getAuth()!.api.getSession({ headers: await headers() });
	if (!session) redirect("/accedi?next=%2Faccount");
	const { user } = session;
	// Attivita' calcolata qui, sul giorno di Roma: il client non ricalcola date.
	const today = todayInRome();
	const sessions = (await listUserSessions(user.id, session.session.id)).map((row) => ({
		id: row.id,
		device: row.device,
		kind: row.kind,
		activity: activityLabel(row.lastActive, row.current, today),
		current: row.current,
	}));

	// Solo il nome del provider: mai una colonna di token (T-25-24).
	const providers = (await prisma.account.findMany({ where: { userId: user.id }, select: { providerId: true } })).map(
		(row) => row.providerId,
	);
	const linked = { apple: providers.includes("apple"), google: providers.includes("google") };

	// Statistiche (27.1, D-12): query whitelisted, qualunque altro valore torna al default (T-27.1-26).
	const q = await searchParams;
	const pick = (key: string) => (typeof q[key] === "string" ? (q[key] as string) : "");
	const vista: Vista = pick("vista") === "salvati" ? "salvati" : "visitati";
	const periodo: Periodo = pick("periodo") === "anno" ? "anno" : "sempre";
	// Solo le righe dell'utente della sessione (T-27.1-25).
	const [visitedRows, savedRows] = await Promise.all([
		prisma.visitedEvent.findMany({ where: { userId: user.id }, select: { visitDay: true, category: true } }),
		prisma.savedEvent.findMany({ where: { userId: user.id }, select: { dateStart: true, dateEnd: true, category: true } }),
	]);
	const visited = visitedRows.map((r) => ({ visitDay: r.visitDay.toISOString().slice(0, 10), category: r.category }));
	const saved = savedRows.map((r) => ({
		dateStart: r.dateStart.toISOString(),
		dateEnd: r.dateEnd ? r.dateEnd.toISOString() : null,
		category: r.category,
	}));
	const currentYear = Number(today.slice(0, 4));
	const years = (vista === "visitati" ? computeVisitedStats(visited, 0) : computeStats(saved, 0)).years;
	const asked = /^\d{4}$/.test(pick("anno")) ? Number(pick("anno")) : null;
	const year = asked !== null && years.includes(asked) ? asked : defaultStatsYear(years, currentYear);
	const stats = vista === "visitati" ? computeVisitedStats(visited, year ?? currentYear) : computeStats(saved, year ?? currentYear);
	const tilesYear = year ?? currentYear;
	const tiles = statsTiles(visited, saved, periodo === "anno" ? tilesYear : null);

	return (
		<>
			<SiteHeader />
			<main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
				<h1 className="mb-8 text-xl font-medium leading-[1.2] text-foreground">Il tuo account</h1>
				<div className="space-y-8">
					<section aria-labelledby="account-profilo">
						<h2 id="account-profilo" className={SECTION_TITLE}>
							Profilo
						</h2>
						<ProfileCard
							initialName={user.name}
							email={user.email}
							image={googleProfileImage(user.image)}
							isRelay={isAppleRelayEmail(user.email)}
						/>
					</section>

					<section aria-labelledby="account-metodi">
						<h2 id="account-metodi" className={SECTION_TITLE}>
							Metodi di accesso
						</h2>
						<SignInMethods linked={linked} appleOn={appleEnabled()} />
					</section>

					<section aria-labelledby="account-sessioni">
						<h2 id="account-sessioni" className={SECTION_TITLE}>
							Sessioni attive
						</h2>
						<SessionsList rows={sessions} />
					</section>

					<section aria-labelledby="account-dati">
						<h2 id="account-dati" className={SECTION_TITLE}>
							I tuoi dati
						</h2>
						<Card className="p-6">
							<p className="text-base text-foreground">
								Scarica una copia di tutti i dati che abbiamo su di te: profilo, account collegati, sessioni, eventi salvati, eventi visitati, collegamento al calendario, link di condivisione della lista, luoghi e categorie che segui, in formato JSON.
							</p>
							<div className="mt-4">
								<ExportButton />
							</div>
						</Card>
					</section>

					<section id="account-segui" aria-labelledby="account-segui-titolo" className="scroll-mt-24">
						<h2 id="account-segui-titolo" className={SECTION_TITLE}>
							Cosa segui
						</h2>
						<Card className="p-6">
							<FollowManager />
						</Card>
					</section>

					<section id="account-statistiche" aria-labelledby="account-statistiche-titolo" className="scroll-mt-24">
						<h2 id="account-statistiche-titolo" className={SECTION_TITLE}>
							Statistiche
						</h2>
						<StatsSection tiles={tiles} stats={stats} year={year} tilesYear={tilesYear} vista={vista} periodo={periodo} />
					</section>

					{/* Le fasi successive inseriscono qui le proprie sezioni, fra "Cosa segui" ed "Esci":
					    Esci ed Elimina account restano sempre in fondo. "Metodi di accesso" fa eccezione per
					    scelta dell'utente (Fase 25): sta subito dopo Profilo. */}

					<section aria-label="Esci">
						<Card className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
							<p className="text-base text-foreground">Esci da questo dispositivo.</p>
							<SignOutButton />
						</Card>
					</section>
				</div>

				{/* Zona separata (D-06): 48px dalla sezione precedente e un filetto. */}
				<section aria-labelledby="account-elimina" className="mt-12 border-t border-border-soft pt-8">
					<h2 id="account-elimina" className={SECTION_TITLE}>
						Elimina account
					</h2>
					<Card className="p-6">
						<p className="text-base text-foreground">
							Cancelliamo subito e per sempre account, sessioni e dati. Non si può annullare.
						</p>
						<div className="mt-4">
							<DeleteAccountSection />
						</div>
					</Card>
				</section>
			</main>
			<Footer />
		</>
	);
}
