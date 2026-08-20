"use client";
// gestori onClick/onChange sui bottoni e sullo slider, animazioni
// framer-motion (motion.div/motion.button): entrambi richiedono il runtime
// del browser (D-12).

import { motion } from "framer-motion";
import { RADIUS_OPTIONS } from "@/lib/destinations";

interface DesktopRadiusPanelProps {
	value: number;
	onValueChange: (value: number) => void;
	onBack: () => void;
	onSelectPreset: (value: number, label: string) => void;
	onApplyCustom: () => void;
}

// Pannello raggio desktop, spostato verbatim da Navbar.tsx (D-09). NON
// unificato con il fratello mobile (MobileRadiusStep): qui cliccare
// un'opzione predefinita conferma SUBITO il raggio, scrive l'etichetta nel
// campo Dove, chiude il pannello e passa a "Quando" — il mobile invece si
// limita a impostare lo slider e aspetta il tocco su "Conferma" (D-16,
// asimmetria preesistente conservata di proposito, non una dimenticanza).
export default function DesktopRadiusPanel({
	value,
	onValueChange,
	onBack,
	onSelectPreset,
	onApplyCustom,
}: DesktopRadiusPanelProps) {
	return (
		<motion.div
			key="radius"
			initial={{ opacity: 0, x: -20 }}
			animate={{ opacity: 1, x: 0 }}
			exit={{ opacity: 0, x: -20 }}
			transition={{ duration: 0.2 }}
			className="p-4 sm:p-8"
		>
			<div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
				<motion.button
					onClick={onBack}
					whileHover={{ scale: 1.05 }}
					whileTap={{ scale: 0.95 }}
					className="w-7 h-7 sm:w-8 sm:h-8 rounded-full hover:bg-muted-strong flex items-center justify-center transition-colors"
				>
					<svg
						className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M15 19l-7-7 7-7"
						/>
					</svg>
				</motion.button>
				<h3 className="text-xs sm:text-sm font-semibold text-foreground">
					Seleziona il raggio
				</h3>
			</div>
			<div className="grid grid-cols-1 gap-4">
				{RADIUS_OPTIONS.map((opt) => (
					<motion.button
						key={opt.value}
						whileHover={{ backgroundColor: "var(--muted)" }}
						whileTap={{ scale: 0.98 }}
						onClick={() => onSelectPreset(opt.value, opt.label)}
						className="flex items-center gap-3 sm:gap-4 p-2 sm:p-3 rounded-xl hover:bg-muted transition-all text-left"
					>
						<div className="w-10 h-10 sm:w-12 sm:h-12 bg-muted-strong rounded-lg flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
							📍
						</div>
						<div className="flex-1">
							<div className="font-medium text-foreground text-sm sm:text-base">
								{opt.label}
							</div>
							<div className="text-xs sm:text-sm text-muted-foreground-subtle">
								{opt.subtitle}
							</div>
						</div>
					</motion.button>
				))}

				{/* Custom Radius */}
				<div className="border-t pt-3 sm:pt-4 mt-2">
					<div className="p-3 sm:p-4 rounded-xl bg-muted">
						<div className="flex items-center justify-between mb-3 sm:mb-4">
							<div className="font-medium text-foreground text-sm sm:text-base">
								Distanza personalizzata
							</div>
							<div className="text-xl sm:text-2xl font-bold text-primary">
								{value} km
							</div>
						</div>
						<div className="mb-4">
							<input
								type="range"
								min="5"
								max="200"
								step="5"
								value={value}
								onChange={(e) => onValueChange(Number(e.target.value))}
								className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer"
								style={{
									background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${((value - 5) / 195) * 100}%, var(--border) ${((value - 5) / 195) * 100}%, var(--border) 100%)`,
								}}
							/>
							<div className="flex justify-between text-xs text-muted-foreground-subtle mt-1">
								<span>5 km</span>
								<span>200 km</span>
							</div>
						</div>
						<motion.button
							whileHover={{ scale: 1.02 }}
							whileTap={{ scale: 0.98 }}
							onClick={onApplyCustom}
							className="w-full px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg hover:shadow-lg transition-all"
						>
							Applica
						</motion.button>
					</div>
				</div>
			</div>
		</motion.div>
	);
}
