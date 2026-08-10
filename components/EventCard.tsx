"use client";

import { Event } from "@/lib/types";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import Link from "next/link";
import { Calendar } from "lucide-react";
import { decodeHtmlEntities } from "@/lib/utils";

interface EventCardProps {
	event: Event;
}

export default function EventCard({ event }: EventCardProps) {
	return (
		<Link href={`/eventi/${event.id}`} className="group cursor-pointer">
			<div className="flex flex-col rounded-card h-full items-stretch p-2 bg-surface border border-primary/10 hover:border-primary/50 transition-all duration-300">
				{/* Image */}
				<div className="relative w-full aspect-16/9 mb-1 sm:mb-3 overflow-hidden rounded-md sm:rounded-xl group-hover:border-primary/50 transition-all duration-300group-hover:shadow-md">
					{event.imageUrl ? (
						<img
							src={event.imageUrl}
							alt={event.title}
							className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
						/>
					) : (
						<div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent-tint via-accent/20 to-primary/10">
							<div className="flex flex-col items-center gap-1 sm:gap-3">
								<div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary/10 flex items-center justify-center">
									<Calendar className="w-3 h-3 sm:w-6 sm:h-6 text-primary" />
								</div>
								<span className="text-[10px] sm:text-xs font-medium text-primary/60">
									Evento
								</span>
							</div>
						</div>
					)}
				</div>

				{/* Info */}
				<div className="flex flex-col gap-0.5">
					<h1 className="text-[16px] sm:text-md font-semibold text-foreground line-clamp-2 leading-tight">
						{decodeHtmlEntities(event.title.toLowerCase().charAt(0).toUpperCase() + event.title.toLowerCase().slice(1))}
					</h1>
					<div className="flex items-center gap-1">
						<span className="text-[10px] sm:text-sm text-muted-foreground line-clamp-1">{event.locationName || "Lombardia"}</span>
						<span> - </span>
						<span className="text-[10px] sm:text-sm text-primary font-medium" suppressHydrationWarning>
							{format(new Date(event.dateStart), "dd MMM", { locale: it })}
						</span>
					</div>
				</div>
			</div>
		</Link>
	);
}
