"use client";

import * as Popover from "@/components/ui/Popover";
import { CalendarPlus, ChevronDown, Download, ExternalLink } from "lucide-react";
import { calendarFields, type CalendarSource } from "@/lib/calendar/ics";
import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/calendar/links";

/**
 * "Aggiungi al calendario" (D-02): quattro link semplici in un popover. Gli
 * href sono puri e deterministici (stesse CalendarFields del .ics), quindi
 * server e client producono lo stesso markup.
 */
const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const ROW =
	`flex min-h-12 items-center gap-2 rounded-md px-4 text-sm font-medium text-foreground hover:bg-muted-strong ${FOCUS_RING}`;

export default function AddToCalendar({ event, canonicalUrl }: { event: CalendarSource; canonicalUrl: string }) {
	const fields = calendarFields(event, canonicalUrl);
	const ics = `/api/events/${event.id}/ics`;

	return (
		<Popover.Root>
			<Popover.Trigger asChild>
				<button
					type="button"
					className={`group flex h-12 min-w-0 flex-1 items-center gap-2 rounded-pill bg-surface px-4 text-sm font-medium text-foreground hover:bg-muted-strong active:bg-muted-strong data-[state=open]:bg-muted-strong sm:flex-none ${FOCUS_RING}`}
					style={{ boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
				>
					<CalendarPlus size={18} aria-hidden="true" className="shrink-0" />
					<span className="truncate">Aggiungi al calendario</span>
					<ChevronDown
						size={16}
						aria-hidden="true"
						className="ml-auto shrink-0 group-data-[state=open]:rotate-180 sm:ml-1"
						style={{ transition: "transform var(--motion-fast) var(--ease-standard)" }}
					/>
				</button>
			</Popover.Trigger>
			<Popover.Content
				align="start"
				aria-label="Aggiungi al calendario"
				style={{ width: "max(var(--radix-popover-trigger-width), 240px)" }}
			>
				<Popover.Close asChild>
					<a href={ics} className={ROW}>
						Apple Calendar
					</a>
				</Popover.Close>
				<Popover.Close asChild>
					<a href={googleCalendarUrl(fields)} target="_blank" rel="noopener noreferrer" className={ROW}>
						Google Calendar
						<ExternalLink size={16} aria-hidden="true" className="ml-auto text-foreground-secondary" />
					</a>
				</Popover.Close>
				<Popover.Close asChild>
					<a href={outlookCalendarUrl(fields)} target="_blank" rel="noopener noreferrer" className={ROW}>
						Outlook
						<ExternalLink size={16} aria-hidden="true" className="ml-auto text-foreground-secondary" />
					</a>
				</Popover.Close>
				<div className="my-1 border-t border-border-soft" />
				<Popover.Close asChild>
					<a href={`${ics}?download=1`} className={ROW}>
						Scarica file .ics
						<Download size={16} aria-hidden="true" className="ml-auto text-foreground-secondary" />
					</a>
				</Popover.Close>
			</Popover.Content>
		</Popover.Root>
	);
}
