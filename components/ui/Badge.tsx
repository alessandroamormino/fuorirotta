import { cn } from "@/lib/utils";

type BadgeVariant = "soft" | "solid";

interface BadgeProps {
	children?: React.ReactNode;
	variant?: BadgeVariant;
	className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
	soft: "bg-accent-tint text-primary",
	solid: "bg-primary text-primary-foreground",
};

export default function Badge({ children, variant = "soft", className }: BadgeProps) {
	if (children == null || (typeof children === "string" && children.trim() === "")) {
		return null;
	}

	return (
		<span
			className={cn(
				"text-xs px-2.5 py-1 rounded-full inline-block whitespace-nowrap truncate max-w-[20ch]",
				variantClasses[variant],
				className
			)}
		>
			{children}
		</span>
	);
}
