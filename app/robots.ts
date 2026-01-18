import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				allow: "/",
				disallow: [
					"/api/",
					"/_next/",
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
		"http://localhost:3000";
	return raw.replace(/\/$/, "");
}
