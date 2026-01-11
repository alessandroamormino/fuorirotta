"use client";

import { Event } from "@/lib/types";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import Link from "next/link";
import { Calendar } from "lucide-react";

interface EventCardProps {
	event: Event;
}

export default function EventCard({ event }: EventCardProps) {
	return (
		<Link href={`/eventi/${event.id}`} className="group cursor-pointer">
			<div className="flex flex-col">
				{/* Image */}
				<div className="relative w-full aspect-square mb-3 overflow-hidden rounded-xl border-2 border-[#83c5be]/30 group-hover:border-[#006d77]/50 transition-all duration-300 shadow-sm group-hover:shadow-md">
					{event.imageUrl ? (
						<img
							src={event.imageUrl}
							alt={event.title}
							className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
						/>
					) : (
						<div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#edf6f9] via-[#83c5be]/20 to-[#006d77]/10">
							<div className="flex flex-col items-center gap-3">
								<div className="w-16 h-16 rounded-full bg-[#006d77]/10 flex items-center justify-center">
									<Calendar className="w-8 h-8 text-[#006d77]" />
								</div>
								<span className="text-xs font-medium text-[#006d77]/60">
									Evento
								</span>
							</div>
						</div>
					)}
				</div>

				{/* Info */}
				<div className="flex flex-col gap-0.5">
					<h3 className="text-sm font-semibold text-gray-900 line-clamp-1">
						{event.locationName || "Lombardia"}
					</h3>
					<p className="text-sm text-gray-600 line-clamp-1">{event.title}</p>
					<p className="text-sm text-[#006d77] font-medium">
						{format(new Date(event.dateStart), "dd MMM", { locale: it })}
					</p>
				</div>
			</div>
		</Link>
	);
}
