"use client";

import { useState } from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { notify } from "@/components/account/NoticeHost";
import type { DeviceKind } from "@/lib/userAgent";

/**
 * Sessioni attive (D-08). Le righe arrivano dal server con l'attivita' gia'
 * calcolata (giorno di Roma): qui nessuna data viene ricalcolata, cosi' la
 * pagina dinamica non puo' avere un mismatch di idratazione. Nessuna conferma
 * per le revoche: si rimedia accedendo di nuovo. IP e luogo non si mostrano.
 */
export interface SessionListRow {
	id: string;
	device: string;
	kind: DeviceKind;
	activity: string;
	current: boolean;
}

const REVOKE_FAILED = "Non siamo riusciti a scollegare il dispositivo. Riprova.";

const ICONS: Record<DeviceKind, typeof Monitor> = { phone: Smartphone, tablet: Tablet, desktop: Monitor };

export default function SessionsList({ rows: initialRows }: { rows: SessionListRow[] }) {
	const [rows, setRows] = useState(initialRows);
	// Una sola revoca alla volta: l'id della riga in volo, "all" per quella di gruppo.
	const [pending, setPending] = useState<string | null>(null);

	const revoke = async (target: string) => {
		if (pending !== null) return;
		setPending(target);
		const all = target === "all";
		try {
			const res = await fetch(all ? "/api/v1/me/sessions" : `/api/v1/me/sessions/${encodeURIComponent(target)}`, {
				method: "DELETE",
			});
			if (res.ok) {
				setRows((prev) => (all ? prev.filter((row) => row.current) : prev.filter((row) => row.id !== target)));
				notify(all ? "Altri dispositivi scollegati" : "Dispositivo scollegato");
			} else {
				notify(REVOKE_FAILED);
			}
		} catch {
			notify(REVOKE_FAILED);
		}
		setPending(null);
	};

	return (
		<Card className="p-0">
			<ul>
				{rows.map((row, index) => {
					const Icon = ICONS[row.kind];
					return (
						<li
							key={row.id}
							className={`flex items-center gap-4 px-6 py-4 ${index > 0 ? "border-t border-border-soft" : ""}`}
						>
							<Icon size={20} aria-hidden="true" className="flex-none text-foreground-secondary" />
							<p className="min-w-0 flex-1">
								<span className="text-base font-medium text-foreground">{row.device}</span>
								<span className="text-sm text-foreground-secondary"> · {row.activity}</span>
							</p>
							{!row.current && (
								<Button
									variant="secondary"
									size="md"
									aria-label={`Esci da ${row.device}`}
									loading={pending === row.id}
									disabled={pending !== null}
									onClick={() => revoke(row.id)}
									className="min-w-20 flex-none"
								>
									Esci
								</Button>
							)}
						</li>
					);
				})}
			</ul>
			<div className="border-t border-border-soft px-6 py-4">
				{rows.length > 1 ? (
					<Button
						variant="secondary"
						size="md"
						loading={pending === "all"}
						disabled={pending !== null}
						onClick={() => revoke("all")}
						className="w-full sm:w-auto sm:min-w-80"
					>
						Esci da tutti gli altri dispositivi
					</Button>
				) : (
					<p className="text-sm text-foreground-secondary">{"Questo è l'unico dispositivo collegato."}</p>
				)}
			</div>
		</Card>
	);
}
