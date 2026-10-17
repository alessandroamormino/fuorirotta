import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { authEnabled, getAuth } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import Card from "@/components/ui/Card";
import ProfileCard from "@/components/account/ProfileCard";
import SessionsList from "@/components/account/SessionsList";
import { DeleteAccountSection, ExportButton, SignOutButton } from "@/components/account/AccountActions";
import { activityLabel, listUserSessions } from "@/lib/account";
import { todayInRome } from "@/lib/dateWindow";
import { googleProfileImage } from "@/lib/profileImage";

// Dinamica per costruzione: legge la sessione, quindi non puo' mai finire in
// una cache condivisa. Nessun'altra pagina importa il codice di questa (D-06).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Il tuo account",
	robots: { index: false },
};

const SECTION_TITLE = "mb-4 text-lg font-medium leading-[1.2] text-foreground";

export default async function AccountPage() {
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
						<ProfileCard initialName={user.name} email={user.email} image={googleProfileImage(user.image)} />
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
								Scarica una copia di tutti i dati che abbiamo su di te: profilo, account collegati e sessioni, in formato JSON.
							</p>
							<div className="mt-4">
								<ExportButton />
							</div>
						</Card>
					</section>

					{/* Le fasi successive inseriscono qui le proprie sezioni, fra "I tuoi dati" ed "Esci":
					    Esci ed Elimina account restano sempre in fondo. */}

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
