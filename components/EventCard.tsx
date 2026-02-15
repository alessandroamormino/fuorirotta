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
			<div className="flex flex-col">
				{/* Image */}
				<div className="relative w-full aspect-square mb-1.5 sm:mb-3 overflow-hidden rounded-md sm:rounded-xl border border-[#83c5be]/30 sm:border-2 group-hover:border-[#006d77]/50 transition-all duration-300 shadow-sm group-hover:shadow-md">
					{event.imageUrl ? (
						<img
							src={event.imageUrl}
							alt={event.title}
							className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
						/>
					) : (
						<div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#edf6f9] via-[#83c5be]/20 to-[#006d77]/10">
							<div className="flex flex-col items-center gap-1 sm:gap-3">
								<div className="w-8 h-8 sm:w-16 sm:h-16 rounded-full bg-[#006d77]/10 flex items-center justify-center">
									<Calendar className="w-4 h-4 sm:w-8 sm:h-8 text-[#006d77]" />
								</div>
								<span className="text-[10px] sm:text-xs font-medium text-[#006d77]/60">
									Evento
								</span>
							</div>
						</div>
					)}
				</div>

				{/* Info */}
				<div className="flex flex-col gap-0.5">
					<h3 className="text-[11px] sm:text-sm font-semibold text-gray-900 line-clamp-2 leading-tight">
						{decodeHtmlEntities(event.title)}
					</h3>
					<p className="text-[10px] sm:text-sm text-gray-600 line-clamp-1">{event.locationName || "Lombardia"}</p>
					<p className="text-[10px] sm:text-sm text-[#006d77] font-medium" suppressHydrationWarning>
						{format(new Date(event.dateStart), "dd MMM", { locale: it })}
					</p>
				</div>
			</div>
		</Link>
	);
}
