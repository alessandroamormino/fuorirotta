"use client";

import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "icon";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: ButtonSize;
	loading?: boolean;
	truncate?: boolean;
	children: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
	primary: "bg-primary text-primary-foreground hover:brightness-90",
	secondary: "bg-muted-strong text-foreground border border-border hover:bg-muted",
	ghost: "bg-transparent text-foreground hover:bg-muted",
	destructive: "bg-destructive text-destructive-foreground hover:brightness-90",
};

const sizeClasses: Record<ButtonSize, string> = {
	sm: "h-9 text-sm px-3",
	md: "h-11 text-base px-4",
	icon: "h-11 w-11 p-0",
};

export default function Button({
	variant = "primary",
	size = "md",
	loading = false,
	truncate = false,
	disabled,
	className,
	children,
	...props
}: ButtonProps) {
	const isDisabled = disabled || loading;

	return (
		<button
			{...props}
			disabled={isDisabled}
			aria-disabled={isDisabled || undefined}
			aria-busy={loading || undefined}
			className={cn(
				"inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
				"disabled:opacity-50 disabled:cursor-not-allowed",
				variantClasses[variant],
				sizeClasses[size],
				className
			)}
		>
			{loading ? (
				<span
					aria-hidden="true"
					className="h-4 w-4 rounded-full border-2 border-current border-t-transparent"
					style={{ animation: "spin 1s linear infinite" }}
				/>
			) : (
				<span className={cn("whitespace-nowrap", truncate && "truncate")}>
					{children}
				</span>
			)}
		</button>
	);
}
