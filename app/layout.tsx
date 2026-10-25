import type { Metadata } from "next";
import "./globals.css";
import { EventCacheProvider } from "@/lib/eventCache";
import { UserStateProvider } from "@/components/account/UserStateProvider";
import NoticeHost from "@/components/account/NoticeHost";

export const viewport = {
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
};

const SITE_URL = (
	process.env.NEXT_PUBLIC_SITE_URL ||
	process.env.SITE_URL ||
	"https://fuori-rotta.it"
).replace(/\/$/, "");

export const metadata: Metadata = {
	title: {
		default: "Fuorirotta",
		template: "%s | Fuorirotta",
	},
	description:
		"Scopri eventi, sagre, feste e manifestazioni vicino a te in Lombardia. Fuorirotta raccoglie gli eventi locali su un'unica piattaforma con mappa interattiva.",
	keywords: [
		"eventi lombardia",
		"sagre lombardia",
		"feste locali",
		"eventi vicino a me",
		"cosa fare nel weekend",
		"manifestazioni lombardia",
		"eventi milano",
		"eventi bergamo",
		"eventi brescia",
	],
	metadataBase: new URL(SITE_URL),
	robots: {
		index: true,
		follow: true,
	},
	openGraph: {
		type: "website",
		locale: "it_IT",
		url: SITE_URL,
		siteName: "Fuorirotta",
		title: "Fuorirotta — Eventi, Sagre e Feste in Lombardia",
		description:
			"Scopri eventi, sagre, feste e manifestazioni vicino a te in Lombardia con mappa interattiva.",
	},
	twitter: {
		card: "summary_large_image",
		title: "Fuorirotta — Eventi, Sagre e Feste in Lombardia",
		description:
			"Scopri eventi, sagre, feste e manifestazioni vicino a te in Lombardia con mappa interattiva.",
	},
};

// Script inline del <head>: tema prima del primo paint. Con l'accesso attivo alla
// build (Fase 23) una riga in piu' riporta su <html> il suggerimento "Per te"
// del dispositivo, cosi' il riquadro riservato (.per-te-slot) si apre prima del
// paint. Uguale per ogni visitatore; senza il flag il testo e' quello di prima.
const PERTE_STATEMENT =
	process.env.NEXT_PUBLIC_AUTH_ENABLED === "true"
		? `
									if (localStorage.getItem('fuorirotta.perte') === '1') {
										document.documentElement.setAttribute('data-perte', '1');
									}`
		: "";

const THEME_SCRIPT = `
							(function () {
								try {
									var stored = localStorage.getItem('theme');
									if (stored === 'dark') {
										document.documentElement.classList.add('dark');
									} else if (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches) {
										document.documentElement.classList.add('dark');
									}${PERTE_STATEMENT}
								} catch (e) {}
							})();
						`;

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="it" suppressHydrationWarning>
			<head>
				<script
					dangerouslySetInnerHTML={{
						__html: THEME_SCRIPT,
					}}
				/>
			</head>
			<body className="antialiased">
				<UserStateProvider>
					<EventCacheProvider>
						{children}
					</EventCacheProvider>
				</UserStateProvider>
				<NoticeHost />
			</body>
		</html>
	);
}
