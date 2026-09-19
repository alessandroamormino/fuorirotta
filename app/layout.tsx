import type { Metadata } from "next";
import "./globals.css";
import { EventCacheProvider } from "@/lib/eventCache";

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
						__html: `
							(function () {
								try {
									var stored = localStorage.getItem('theme');
									if (stored === 'dark') {
										document.documentElement.classList.add('dark');
									} else if (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches) {
										document.documentElement.classList.add('dark');
									}
								} catch (e) {}
							})();
						`,
					}}
				/>
			</head>
			<body className="antialiased">
				<EventCacheProvider>
					{children}
				</EventCacheProvider>
			</body>
		</html>
	);
}
