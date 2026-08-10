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

const sizeClasses: Record<InputSize, string> = {
	sm: "h-9 text-sm px-3",
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
