import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { authEnabled, getAuth } from "@/lib/auth";
import { safeNextPath } from "@/lib/safeNextPath";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import Card from "@/components/ui/Card";
import { SignInPanel } from "@/components/account/SignIn";

// Pagina di ripiego per link diretti e ritorni da Google (D-02): dinamica
// perche' legge la sessione, mai in cache, mai indicizzata.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Accedi",
	robots: { index: false },
};

export default async function AccediPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
	// Interruttore spento: la pagina non esiste (D-16).
	if (!authEnabled()) notFound();
	const { next: rawNext } = await searchParams;
	const next = typeof rawNext === "string" ? rawNext : undefined;
	// Un solo percorso ammesso (T-21-32): se la forma non e' sicura si ripiega, mai si inoltra.
	const safe = safeNextPath(next);

	const session = await getAuth()!.api.getSession({ headers: await headers() });
	if (session) redirect(next !== undefined && safe === next ? safe : "/account");

	return (
		<>
			<SiteHeader />
			<main className="mx-auto max-w-sm px-4 py-12">
				<Card className="p-6">
					<SignInPanel
						heading={<h1 className="mb-6 text-xl font-medium leading-[1.2] text-foreground">Accedi</h1>}
						callbackPath={safe}
					/>
				</Card>
			</main>
			<Footer />
		</>
	);
}
