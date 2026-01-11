import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Event as PrismaEvent } from "@prisma/client";
import { Event } from "@/lib/types";

// Helper per convertire Decimal in number
function convertEventCoordinates(event: PrismaEvent): Event {
	return {
		...event,
		latitude: event.latitude ? parseFloat(event.latitude.toString()) : null,
		longitude: event.longitude ? parseFloat(event.longitude.toString()) : null,
	};
}

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;
		const eventId = parseInt(id);

		if (isNaN(eventId)) {
			return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
		}

		const event = await prisma.event.findUnique({
			where: { id: eventId },
		});

		if (!event) {
			return NextResponse.json({ error: "Event not found" }, { status: 404 });
		}

		return NextResponse.json(convertEventCoordinates(event));
	} catch (error) {
		console.error("Error fetching event:", error);
		return NextResponse.json(
			{ error: "Failed to fetch event" },
			{ status: 500 }
		);
	}
}
