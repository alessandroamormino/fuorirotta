"use client";
// gestori onClick/onChange sui bottoni e sullo slider, animazioni
// framer-motion (motion.div/motion.button): entrambi richiedono il runtime
// del browser (D-12).

import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { RADIUS_OPTIONS } from "@/lib/destinations";

interface MobileRadiusStepProps {
	value: number;
	onValueChange: (value: number) => void;
	onBack: () => void;
	onConfirm: () => void;
}

// Passo "Nelle vicinanze" dell'overlay mobile, spostato verbatim da
// Navbar.tsx (D-09): NON unificato con il selettore raggio desktop, che ha
// markup materialmente diverso — qui bordo spesso + spunta + "Conferma", là
// riga con icona + "Applica" (09-05 estrae quello desktop in un file suo).
// Cliccare un'opzione predefinita imposta solo il valore dello slider: la
// conferma resta il pulsante in fondo, comportamento invariato.
export default function MobileRadiusStep({
	value,
	onValueChange,
	onBack,
	onConfirm,
}: MobileRadiusStepProps) {
	return (
		<motion.div
			key="dove-nearby"
			initial={{ opacity: 0, x: 16 }}
			animate={{ opacity: 1, x: 0 }}
			exit={{ opacity: 0, x: 16 }}
			transition={{ duration: 0.2 }}
		>
			{/* Header con back */}
			<div className="flex items-center gap-3 mb-6">
				<motion.button
					whileTap={{ scale: 0.9 }}
					onClick={onBack}
					className="w-8 h-8 rounded-full hover:bg-muted-strong flex items-center justify-center transition-colors"
				>
					<ChevronLeft className="w-5 h-5 text-muted-foreground" />
				</motion.button>
				<h2 className="text-2xl font-bold text-foreground">Nelle vicinanze</h2>
			</div>

			{/* Opzioni predefinite */}
			<div className="grid grid-cols-1 gap-2 mb-5">
				{RADIUS_OPTIONS.map((r) => (
					<motion.button
						key={r.value}
						whileTap={{ scale: 0.98 }}
						onClick={() => onValueChange(r.value)}
						className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all ${
							value === r.value
								? "border-primary bg-primary/5"
								: "border-muted-strong hover:border-border"
						}`}
					>
						<div className="text-left">
							<div className="font-semibold text-foreground text-sm">
								{r.label}
							</div>
							<div className="text-xs text-muted-foreground-subtle">
								{r.subtitle}
							</div>
						</div>
						{value === r.value && (
							<div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
								<svg
									className="w-3 h-3 text-primary-foreground"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={3}
										d="M5 13l4 4L19 7"
									/>
								</svg>
							</div>
						)}
					</motion.button>
				))}
			</div>

			{/* Slider personalizzato */}
			<div className="bg-muted rounded-xl p-4 mb-6">
				<div className="flex items-center justify-between mb-3">
					<span className="text-sm font-medium text-foreground-secondary">
						Distanza personalizzata
					</span>
					<span className="text-base font-bold text-primary">{value} km</span>
				</div>
				<input
					type="range"
					min="5"
					max="200"
					step="5"
					value={value}
					onChange={(e) => onValueChange(Number(e.target.value))}
					className="slider w-full h-2 rounded-lg appearance-none cursor-pointer"
					style={{
						background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${((value - 5) / 195) * 100}%, var(--border) ${((value - 5) / 195) * 100}%, var(--border) 100%)`,
					}}
				/>
				<div className="flex justify-between text-xs text-muted-foreground-faint mt-1">
					<span>5 km</span>
					<span>200 km</span>
				</div>
			</div>

			{/* Conferma */}
			<motion.button
				whileHover={{ scale: 1.02 }}
				whileTap={{ scale: 0.97 }}
				onClick={onConfirm}
				className="w-full py-3 bg-primary hover:bg-primary-hover text-primary-foreground font-semibold rounded-xl transition-colors"
			>
				Conferma
			</motion.button>
		</motion.div>
	);
}
