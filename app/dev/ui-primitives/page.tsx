"use client";

// ponytail: pagina demo unica invece di Storybook — 8 primitive ci stanno comode
// in una sola pagina; se il numero di primitive dovesse crescere oltre a questo,
// il percorso di upgrade è introdurre Storybook (o simile), non allungare questa pagina.

import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import DateRangeField from "@/components/ui/DateRangeField";
import ThemeToggle from "@/components/ui/ThemeToggle";
import * as Popover from "@/components/ui/Popover";
import * as Dialog from "@/components/ui/Dialog";

function Section({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-4">
			<div>
				<h2 className="text-2xl font-semibold text-foreground">{title}</h2>
				{description && (
					<p className="text-sm text-muted-foreground mt-1">{description}</p>
				)}
			</div>
			<div className="flex flex-wrap items-start gap-6">{children}</div>
		</section>
	);
}

function Instance({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col items-start gap-2">
			<span className="text-xs font-medium text-muted-foreground-subtle">
				{label}
			</span>
			{children}
		</div>
	);
}

export default function UIPrimitivesPage() {
	const [dateRange, setDateRange] = useState<{
		dateFrom: Date | null;
		dateTo: Date | null;
	}>({ dateFrom: null, dateTo: null });

	return (
		<main className="min-h-screen bg-background text-foreground">
			<div className="mx-auto max-w-5xl px-6 py-16 space-y-20">
				<header className="space-y-2">
					<h1 className="text-4xl font-semibold text-foreground">
						UI Primitives
					</h1>
					<p className="text-base text-muted-foreground max-w-2xl">
						Rotta demo non linkata, non indicizzata: mostra ogni primitiva di{" "}
						<code>components/ui/</code> in isolamento, con tutte le varianti e
						gli stati applicabili, in entrambi i temi. Nessun fetch, nessun
						dato applicativo — solo stato locale per l&apos;intervallo date.
					</p>
				</header>

				{/* Button */}
				<Section title="Button" description="Quattro varianti x tre size, più stati.">
					{(["primary", "secondary", "ghost", "destructive"] as const).map(
						(variant) => (
							<div key={variant} className="flex flex-col gap-3">
								<span className="text-xs font-medium text-muted-foreground-subtle">
									{variant}
								</span>
								<div className="flex flex-wrap items-center gap-3">
									<Instance label="sm">
										<Button variant={variant} size="sm">
											Conferma
										</Button>
									</Instance>
									<Instance label="md">
										<Button variant={variant} size="md">
											Conferma
										</Button>
									</Instance>
									<Instance label="icon">
										<Button variant={variant} size="icon" aria-label="Azione">
											+
										</Button>
									</Instance>
								</div>
							</div>
						)
					)}
					<Instance label="disabled">
						<Button disabled>Non disponibile</Button>
					</Instance>
					<Instance label="loading">
						<Button loading>Salvataggio…</Button>
					</Instance>
					<Instance label="etichetta lunga (whitespace-nowrap, default)">
						<div className="w-40 overflow-x-auto">
							<Button>Questa è una etichetta piuttosto lunga per un bottone</Button>
						</div>
					</Instance>
					<Instance label="etichetta lunga (truncate)">
						<div className="w-40">
							<Button truncate>Questa è una etichetta piuttosto lunga per un bottone</Button>
						</div>
					</Instance>
				</Section>

				{/* Input */}
				<Section title="Input" description="Stati vuoto, riempito, disabled, invalid.">
					<Instance label="vuoto (placeholder)">
						<Input placeholder="Cerca un comune…" />
					</Instance>
					<Instance label="riempito">
						<Input defaultValue="Bergamo" />
					</Instance>
					<Instance label="disabled">
						<Input disabled defaultValue="Non modificabile" />
					</Instance>
					<Instance label="invalid">
						<Input
							invalid
							errorMessage="Formato non valido"
							defaultValue="12/34/5678"
						/>
					</Instance>
					<Instance label="valore molto lungo (scroll orizzontale nativo)">
						<div className="w-48">
							<Input defaultValue="Un valore di testo decisamente più lungo della larghezza visibile del campo" />
						</div>
					</Instance>
				</Section>

				{/* Card */}
				<Section title="Card" description="Superficie nuda, popolata, interattiva, con testo troncato.">
					<Instance label="vuota (superficie nuda)">
						<Card className="w-56 h-24" />
					</Instance>
					<Instance label="popolata">
						<Card className="w-56 p-4">
							<h3 className="font-semibold text-foreground">Sagra del Paese</h3>
							<p className="text-sm text-muted-foreground mt-1">
								15 Agosto — Piazza Centrale
							</p>
						</Card>
					</Instance>
					<Instance label="interactive">
						<Card interactive className="w-56 p-4">
							<h3 className="font-semibold text-foreground">Festa Patronale</h3>
							<p className="text-sm text-muted-foreground mt-1">Hover per bordo e ombra</p>
						</Card>
					</Instance>
					<Instance label="testo lungo (line-clamp-2 del figlio)">
						<Card className="w-56 p-4">
							<p className="text-sm text-foreground line-clamp-2">
								Questo è un testo decisamente più lungo di quanto la card possa
								mostrare su due sole righe, così da dimostrare il troncamento
								affidato al figlio tramite line-clamp-2 e non alla Card stessa.
							</p>
						</Card>
					</Instance>
				</Section>

				{/* Badge */}
				<Section title="Badge" description="Soft, solid, etichetta vuota, etichetta lunga.">
					<Instance label="soft">
						<Badge variant="soft">Musica</Badge>
					</Instance>
					<Instance label="solid">
						<Badge variant="solid">Musica</Badge>
					</Instance>
					<Instance label="etichetta vuota (non renderizza nulla)">
						<div className="h-6 w-24 border border-dashed border-border rounded-full flex items-center justify-center">
							<Badge>{""}</Badge>
							<span className="text-[10px] text-muted-foreground-faint">
								(vuoto)
							</span>
						</div>
					</Instance>
					<Instance label="etichetta lunga (truncate)">
						<div className="w-32">
							<Badge variant="soft">Manifestazioni Enogastronomiche Regionali</Badge>
						</div>
					</Instance>
				</Section>

				{/* DateRangeField */}
				<Section
					title="DateRangeField"
					description="Entrambe le variant, alimentate da uno stato locale della pagina."
				>
					<Instance label="desktop">
						<div className="w-[560px] max-w-full border border-border rounded-lg p-4">
							<DateRangeField
								variant="desktop"
								dateFrom={dateRange.dateFrom}
								dateTo={dateRange.dateTo}
								onChange={setDateRange}
							/>
						</div>
					</Instance>
					<Instance label="mobile">
						<div className="w-80 h-[520px] flex flex-col overflow-hidden border border-border rounded-lg">
							<DateRangeField
								variant="mobile"
								dateFrom={dateRange.dateFrom}
								dateTo={dateRange.dateTo}
								onChange={setDateRange}
							/>
						</div>
					</Instance>
				</Section>

				{/* ThemeToggle */}
				<Section
					title="ThemeToggle"
					description="Istanza reale montata qui — light/dark si invertono sul posto (oltre all'istanza fissa globale in alto a destra)."
				>
					<Instance label="istanza inline">
						<div className="relative h-14 w-14 border border-border rounded-lg">
							<ThemeToggle />
						</div>
					</Instance>
				</Section>

				{/* Popover */}
				<Section
					title="Popover"
					description="Ancorato, aria-expanded sul trigger, contenuto scrollabile internamente."
				>
					<Instance label="trigger con lista lunga (voci troncate)">
						<Popover.Root>
							<Popover.Trigger asChild>
								<Button variant="secondary">Apri Popover</Button>
							</Popover.Trigger>
							<Popover.Content className="w-64">
								<ul className="space-y-1">
									{[
										"Bergamo",
										"Brescia",
										"Como",
										"Cremona",
										"Lecco",
										"Lodi",
										"Mantova",
										"Milano",
										"Monza e della Brianza",
										"Pavia",
										"Sondrio",
										"Varese",
										"Una voce con un nome di comune davvero molto lungo per il troncamento",
									].map((comune) => (
										<li
											key={comune}
											className="truncate text-sm text-foreground px-2 py-1.5 rounded-md hover:bg-muted-strong"
										>
											{comune}
										</li>
									))}
								</ul>
							</Popover.Content>
						</Popover.Root>
					</Instance>
				</Section>

				{/* Dialog */}
				<Section
					title="Dialog"
					description="Modale a tutto schermo, focus trap Radix, scroll interno oltre l'altezza massima."
				>
					<Instance label="trigger con contenuto oltre max-h-[90vh]">
						<Dialog.Root>
							<Dialog.Trigger asChild>
								<Button>Apri Dialog</Button>
							</Dialog.Trigger>
							<Dialog.Content>
								<Dialog.Title className="text-lg font-semibold text-foreground">
									Dettagli evento
								</Dialog.Title>
								<Dialog.Description className="text-sm text-muted-foreground mt-1">
									Contenuto sufficientemente lungo da superare l&apos;altezza
									massima e dimostrare lo scorrimento interno del pannello.
								</Dialog.Description>
								<div className="mt-4 space-y-3 text-sm text-foreground-secondary">
									{Array.from({ length: 20 }).map((_, i) => (
										<p key={i}>
											Riga di contenuto {i + 1} — testo segnaposto per riempire
											il pannello e forzare lo scroll interno.
										</p>
									))}
								</div>
								<div className="mt-6 flex justify-end">
									<Dialog.Close asChild>
										<Button variant="secondary">Chiudi</Button>
									</Dialog.Close>
								</div>
							</Dialog.Content>
						</Dialog.Root>
					</Instance>
				</Section>
			</div>
		</main>
	);
}
