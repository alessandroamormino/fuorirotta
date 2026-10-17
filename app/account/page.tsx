import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { authEnabled, getAuth } from "@/lib/auth";
import SiteHeader from "@/components/SiteHeader";
import ProfileCard from "@/components/account/ProfileCard";

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
						<ProfileCard initialName={user.name} email={user.email} />
					</section>
				</div>
			</main>
		</>
	);
}
