import { cn } from "@/lib/utils";

interface CardProps {
	children?: React.ReactNode;
	className?: string;
	interactive?: boolean;
}

export default function Card({ children, className, interactive = false }: CardProps) {
	return (
		<div
			className={cn(
				"bg-surface border border-border rounded-card overflow-hidden",
				interactive && "hover:border-primary/50 hover:shadow-sm transition-all",
				className
			)}
		>
			{children}
		</div>
	);
}
