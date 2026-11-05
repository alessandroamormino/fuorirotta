import Link from "next/link";
import Card from "@/components/ui/Card";
import { categoryVisual } from "@/lib/categories/visuals";
import type { Stats } from "@/lib/stats/compute";
import { cn } from "@/lib/utils";

// Server component: nessun JavaScript nel browser, nessuna libreria di grafici (D-12).
// I numeri arrivano da lib/stats/compute.ts, lo stesso calcolo dell'app.

export type Vista = "visitati" | "salvati";
export type Periodo = "sempre" | "anno";

interface Props {
	tiles: { daysOut: number; visited: number; saved: number };
	stats: Stats;
	/** Anno della griglia e dei grafici; null se la lista scelta e' vuota. */
	year: number | null;
	/** Anno delle tessere quando il periodo e' "anno". */
	tilesYear: number;
	vista: Vista;
	periodo: Periodo;
}

const MESI = Array.from({ length: 12 }, (_, m) =>
	new Intl.DateTimeFormat("it-IT", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, m, 15))),
);
const GIORNO = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", timeZone: "UTC" });

// Cinque gradini d'intensita' dal token dell'accento, come l'app (0.30 / 0.55 / 0.80 / 1.0).
const HEAT = ["bg-muted-strong", "bg-primary/30", "bg-primary/55", "bg-primary/80", "bg-primary"];

const SEGMENT = "rounded-full px-4 py-2 text-sm font-medium transition-colors";

function href(vista: Vista, periodo: Periodo, anno: number | null) {
	const q = new URLSearchParams({ vista, periodo });
	if (anno !== null) q.set("anno", String(anno));
	return `/account?${q.toString()}#account-statistiche`;
}

function Segmented({ label, items }: { label: string; items: Array<{ text: string; to: string; active: boolean }> }) {
	return (
		<nav aria-label={label} className="inline-flex gap-1 rounded-full bg-surface p-1">
			{items.map((it) => (
				<Link
					key={it.text}
					href={it.to}
					aria-current={it.active ? "true" : undefined}
					className={cn(SEGMENT, it.active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted-strong")}
				>
					{it.text}
				</Link>
			))}
		</nav>
	);
}

/** Colonne = settimane da lunedi' a domenica; null = giorno fuori dall'anno. */
function yearWeeks(year: number): Array<Array<string | null>> {
	const jan1 = new Date(Date.UTC(year, 0, 1));
	const dec31 = Date.UTC(year, 11, 31);
	const cursor = new Date(jan1.getTime() - ((jan1.getUTCDay() + 6) % 7) * 86400000);
	const weeks: Array<Array<string | null>> = [];
	while (cursor.getTime() <= dec31) {
		const week: Array<string | null> = [];
		for (let d = 0; d < 7; d++) {
			week.push(cursor.getUTCFullYear() === year ? cursor.toISOString().slice(0, 10) : null);
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		}
		weeks.push(week);
	}
	return weeks;
}

function cellLabel(day: string, n: number, vista: Vista) {
	const quanti =
		vista === "visitati"
			? n === 0 ? "nessun evento visitato" : n === 1 ? "1 evento visitato" : `${n} eventi visitati`
			: n === 0 ? "nessun evento salvato" : n === 1 ? "1 evento salvato" : `${n} eventi salvati`;
	return `${GIORNO.format(new Date(`${day}T12:00:00Z`))}, ${quanti}`;
}

function Tile({ id, label, value, className }: { id: string; label: string; value: number; className: string }) {
	return (
		<div className={cn("rounded-md p-5", className)}>
			<p className="text-sm font-medium">{label}</p>
			<p data-tile={id} className="mt-1 text-xl font-medium leading-[1.2]">{value}</p>
		</div>
	);
}

export default function StatsSection({ tiles, stats, year, tilesYear, vista, periodo }: Props) {
	const noun = vista === "visitati" ? "Visitati" : "Salvati";
	const peak = Math.max(...stats.perMonth, 1);
	const top = Math.max(...stats.perCategory.map(([, n]) => n), 1);
	return (
		<div className="space-y-4">
			<Segmented
				label="Periodo delle tessere"
				items={[
					{ text: "Sempre", to: href(vista, "sempre", year), active: periodo === "sempre" },
					{ text: String(tilesYear), to: href(vista, "anno", tilesYear), active: periodo === "anno" },
				]}
			/>
			<div className="grid grid-cols-2 gap-3">
				<div className="col-span-2">
					<Tile id="giorni-fuori" label="Giorni fuori" value={tiles.daysOut} className="bg-primary text-primary-foreground" />
				</div>
				<Tile id="visitati" label="Visitati" value={tiles.visited} className="bg-primary text-primary-foreground" />
				<Tile id="salvati" label="Salvati" value={tiles.saved} className="bg-status-soon text-destructive-foreground" />
			</div>

			<Segmented
				label="Lista"
				items={[
					{ text: "Visitati", to: href("visitati", periodo, year), active: vista === "visitati" },
					{ text: "Salvati", to: href("salvati", periodo, year), active: vista === "salvati" },
				]}
			/>

			{year === null ? (
				<Card className="p-6">
					<p className="text-base text-foreground">
						{vista === "visitati"
							? "Segna 'Ci sono stato' su un evento: qui vedrai dove sei stato."
							: "Salva qualche evento: qui vedrai quando e cosa ti piace."}
					</p>
				</Card>
			) : (
				<>
					{stats.years.length > 1 && (
						<nav aria-label="Anno" className="flex flex-wrap gap-2">
							{stats.years.map((y) => (
								<Link
									key={y}
									href={href(vista, periodo, y)}
									aria-current={y === year ? "true" : undefined}
									className={cn(SEGMENT, y === year ? "bg-primary text-primary-foreground" : "bg-surface text-foreground hover:bg-muted-strong")}
								>
									{y}
								</Link>
							))}
						</nav>
					)}

					<Card className="p-6">
						<h3 className="mb-4 text-base font-medium text-foreground">Attività dell&apos;anno {year}</h3>
						<div className="overflow-x-auto pb-2">
							<div className="grid w-max grid-flow-col grid-rows-7 gap-1">
								{yearWeeks(year).flatMap((week) =>
									week.map((day, i) => {
										if (day === null) return <div key={`v${week[6]}${i}`} className="h-3 w-3" />;
										const n = stats.days[day] ?? 0;
										return (
											<div
												key={day}
												role="img"
												aria-label={cellLabel(day, n, vista)}
												className={cn("h-3 w-3 rounded-[3px]", HEAT[Math.min(n, 4)])}
											/>
										);
									}),
								)}
							</div>
						</div>
					</Card>

					<Card className="p-6">
						<h3 className="mb-4 text-base font-medium text-foreground">{`${noun} per mese`}</h3>
						<ul className="space-y-2">
							{stats.perMonth.map((n, m) => (
								<li key={MESI[m]} className="flex items-center gap-3 text-sm">
									<span className="w-20 flex-none capitalize text-muted-foreground">{MESI[m]}</span>
									<span className="h-2 flex-1 rounded-full bg-muted-strong">
										<span className="block h-2 rounded-full bg-primary" style={{ width: `${(n / peak) * 100}%` }} />
									</span>
									<span className="w-6 flex-none text-right tabular-nums text-foreground">{n}</span>
								</li>
							))}
						</ul>
					</Card>

					<Card className="p-6">
						<h3 className="mb-4 text-base font-medium text-foreground">{`${noun} per categoria`}</h3>
						{stats.perCategory.length === 0 ? (
							<p className="text-sm text-muted-foreground">Nessun evento in questo anno.</p>
						) : (
							<ul className="space-y-3">
								{stats.perCategory.map(([name, n]) => {
									const { token, Icon } = categoryVisual(name);
									return (
										<li key={name} className="text-sm">
											<div className="mb-1 flex items-center gap-2 text-foreground">
												<Icon size={16} aria-hidden="true" style={{ color: `var(${token})` }} />
												<span className="flex-1">{name}</span>
												<span className="tabular-nums">{n}</span>
											</div>
											<span className="block h-2 rounded-full bg-muted-strong">
												<span className="block h-2 rounded-full" style={{ width: `${(n / top) * 100}%`, background: `var(${token})` }} />
											</span>
										</li>
									);
								})}
							</ul>
						)}
					</Card>
				</>
			)}
		</div>
	);
}
