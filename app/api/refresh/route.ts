import { NextRequest, NextResponse } from "next/server";
import { createWorkflowExecution, waitForExecution } from "@/lib/cacheService";
import { triggerN8nWorkflow } from "@/lib/n8nClient";

const LOMBARDY_CITIES = [
	"Milano",
	"Bergamo",
	"Brescia",
	"Como",
	"Cremona",
	"Lecco",
	"Lodi",
	"Mantova",
	"Monza",
	"Pavia",
	"Sondrio",
	"Varese",
];

/**
 * Endpoint per refreshare manualmente i dati da OpenData Lombardia
 * Può essere chiamato manualmente o da un cron job
 *
 * Usage:
 * POST /api/refresh
 *
 * Optional body:
 * {
 *   "cities": ["Milano", "Bergamo"],  // Default: tutte le città lombarde
 *   "dateFrom": "2026-01-09",          // Default: oggi
 *   "dateTo": "2026-12-31",            // Default: fine anno
 *   "wait": true                       // Default: false (risponde subito)
 * }
 */
export async function POST(request: NextRequest) {
	try {
		const body = await request.json().catch(() => ({}));

		const today = new Date().toISOString().split("T")[0];
		const endOfYear = `${new Date().getFullYear()}-12-31`;

		const cacheQuery = {
			cities: body.cities || LOMBARDY_CITIES,
			radiusKm: undefined, // Non serve per lo scraping globale
			centerLat: undefined,
			centerLng: undefined,
			dateFrom: body.dateFrom || today,
			dateTo: body.dateTo || endOfYear,
		};

		console.log(
			"[Refresh] Triggering n8n workflow for global data refresh:",
			cacheQuery
		);
		const executionId = await createWorkflowExecution(cacheQuery);
		const triggered = await triggerN8nWorkflow(cacheQuery, executionId);

		if (!triggered) {
			return NextResponse.json(
				{ success: false, error: "Failed to trigger n8n workflow" },
				{ status: 500 }
			);
		}

		// Se wait=true, aspetta il completamento
		if (body.wait) {
			console.log("[Refresh] Waiting for workflow completion...");
			const completed = await waitForExecution(executionId, 120000); // 2 minuti

			if (completed) {
				return NextResponse.json({
					success: true,
					message: "Data refresh completed successfully",
					executionId,
				});
			} else {
				return NextResponse.json(
					{
						success: false,
						message: "Workflow timeout - check execution status manually",
						executionId,
					},
					{ status: 202 }
				);
			}
		}

		// Risposta immediata senza aspettare
		return NextResponse.json({
			success: true,
			message: "Data refresh triggered successfully",
			executionId,
			note: "Refresh is running in background",
		});
	} catch (error) {
		console.error("[Refresh] Error:", error);
		return NextResponse.json(
			{ success: false, error: "Internal server error" },
			{ status: 500 }
		);
	}
}

/**
 * GET endpoint per verificare lo stato del sistema
 */
export async function GET() {
	return NextResponse.json({
		message: "Data refresh endpoint",
		usage: {
			method: "POST",
			body: {
				cities:
					"Array<string> (optional) - Cities to refresh, defaults to all Lombardy cities",
				dateFrom:
					"string (optional) - Start date in YYYY-MM-DD format, defaults to today",
				dateTo:
					"string (optional) - End date in YYYY-MM-DD format, defaults to end of year",
				wait: "boolean (optional) - Wait for completion, defaults to false",
			},
			examples: {
				triggerImmediate: "POST /api/refresh",
				triggerAndWait: 'POST /api/refresh with {"wait": true}',
				specificCities:
					'POST /api/refresh with {"cities": ["Milano", "Bergamo"]}',
			},
		},
	});
}
