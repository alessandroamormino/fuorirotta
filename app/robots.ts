import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				// Il percorso .well-known e' esplicito: il disallow dei .json non deve coprire assetlinks.json.
				allow: ["/", "/.well-known/"],
				disallow: [
					"/api/",
					"/cal/",
					"/*.json$",
					"/*.map$",
				],
			},
		],
		sitemap: `${getBaseUrl()}/sitemap.xml`,
	};
}

function getBaseUrl() {
	const raw =
		process.env.NEXT_PUBLIC_SITE_URL ||
		process.env.SITE_URL ||
		"https://fuori-rotta.it";
	return raw.replace(/\/$/, "");
}
