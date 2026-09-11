"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

type InputSize = "sm" | "md";

interface InputProps
	extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
	size?: InputSize;
	invalid?: boolean;
	errorMessage?: string;
}

// UAT da telefono vero, produzione, 2026-09-10 (rilievo 1): nessun call site
// passa size="sm" oggi (verificato), ma se uno arrivasse su un campo
// focusabile touch text-sm/14px farebbe zoomare iOS Safari (soglia 16px).
// "sm" resta piu' basso in altezza di "md", solo il font non scende sotto 16px.
const sizeClasses: Record<InputSize, string> = {
	// text-sm e' la misura di disegno della taglia piccola; pointer-coarse la
	// porta a 16px SOLO sui dispositivi touch, dove sotto quella soglia iOS
	// Safari zooma da solo al focus. Non alzarla a 16px fissi: renderebbe ogni
	// form desktop futuro piu' grande del disegno senza una ragione visibile.
	sm: "h-9 text-sm pointer-coarse:text-base px-3",
	md: "h-11 text-base px-4",
};

export default function Input({
	size = "md",
	invalid = false,
	errorMessage,
	disabled,
	className,
	"aria-describedby": ariaDescribedby,
	...props
}: InputProps) {
	const errorId = useId();
	const describedBy = errorMessage
		? [ariaDescribedby, errorId].filter(Boolean).join(" ")
		: ariaDescribedby;

	return (
		<div>
			<input
				{...props}
				disabled={disabled}
				aria-invalid={invalid || undefined}
				aria-describedby={describedBy || undefined}
				className={cn(
					"border border-border bg-surface text-foreground rounded-md",
					"placeholder-muted-foreground-faint",
					"hover:border-muted-foreground-faint",
					"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus:border-primary",
					"disabled:opacity-50 disabled:bg-muted disabled:cursor-not-allowed",
					invalid && "border-destructive focus-visible:ring-destructive",
					sizeClasses[size],
					className
				)}
			/>
			{errorMessage && (
				<p id={errorId} role="alert" className="text-destructive text-sm mt-1">
					{errorMessage}
				</p>
			)}
		</div>
	);
}
