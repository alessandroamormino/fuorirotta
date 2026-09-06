import { cn } from "@/lib/utils";
import type { EventStatusTone } from "@/lib/eventStatus";

type StatusBadgeVariant = "card" | "pill";

interface StatusBadgeProps {
	label: string;
	tone: EventStatusTone;
	/**
	 * `card`: pillola smerigliata ancorata sopra la foto della card lista.
	 * `pill`: pillola del dettaglio, su superficie `--surface` con anello interno.
	 */
	variant?: StatusBadgeVariant;
	className?: string;
}

/**
 * Badge di stato (Oggi/In corso/Domani/Fra N giorni/Concluso/range), le due
 * varianti del contratto UI-SPEC "Badge di stato". Il pallino e' un rinforzo
 * ridondante — D-21 vincolante: l'etichetta non e' mai colorata e non vive
 * mai sul grigio debole (`--muted-foreground-subtle`). Live/soon restano su
 * `--foreground`, later scende a `--foreground-secondary` — mai sul token in
 * deroga WCAG.
 */
export default function StatusBadge({ label, tone, variant = "card", className }: StatusBadgeProps) {
	if (label == null || label.trim() === "") {
		return null;
	}

	const isLater = tone === "later";

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-pill px-[10px] py-[5px] text-xs font-semibold tracking-[-0.01em]",
				variant === "card"
					? "backdrop-blur-md backdrop-saturate-[180%] shadow-[0_2px_8px_rgba(0,0,0,0.14)]"
					: "shadow-[inset_0_0_0_1px_var(--border-soft)]",
				isLater ? "text-foreground-secondary" : "text-foreground",
				className
			)}
			style={{
				background: variant === "card" ? "color-mix(in srgb, var(--background) 88%, transparent)" : "var(--surface)",
			}}
		>
			{!isLater && (
				<i
					aria-hidden="true"
					className="block h-1.5 w-1.5 rounded-full"
					style={{ background: tone === "live" ? "var(--success)" : "var(--primary)" }}
				/>
			)}
			{label}
		</span>
	);
}
