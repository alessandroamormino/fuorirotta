import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
	try {
		const categories = await prisma.event.findMany({
			where: {
				category: {
					not: null,
				},
			},
			select: {
				category: true,
			},
			distinct: ["category"],
			orderBy: {
				category: "asc",
			},
		});

		// Count events per category
		const categoriesWithCount = await Promise.all(
			categories.map(async (cat: { category: string | null }) => {
				const count = await prisma.event.count({
					where: { category: cat.category },
				});
				return {
					name: cat.category,
					count,
				};
			})
		);

		return NextResponse.json(categoriesWithCount);
	} catch (error) {
		console.error("Error fetching categories:", error);
		return NextResponse.json(
			{ error: "Failed to fetch categories" },
			{ status: 500 }
		);
	}
}
