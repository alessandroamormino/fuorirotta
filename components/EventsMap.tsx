"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Event } from "@/lib/types";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { getEventCoordinates } from "@/lib/cityCoordinates";

interface EventsMapProps {
	events: Event[];
	initialGeoJSON?: GeoJSON.FeatureCollection;
	onEventClick?: (event: Event) => void;
	mapId?: string;
	disablePopups?: boolean;
	userLocation?: { lat: number; lng: number } | null;
}

const MAP_STYLE_LIGHT = "mapbox://styles/mapbox/streets-v12";
const MAP_STYLE_DARK = "mapbox://styles/mapbox/dark-v11";

const EMPTY_GEOJSON: GeoJSON.FeatureCollection = {
	type: "FeatureCollection",
	features: [],
};

// Calcolati una volta: usano var(--primary) direttamente, quindi seguono il tema
// via cascata CSS senza bisogno di essere ri-derivati a ogni apertura di popup.
const CTA_SHADOW = "0 4px 12px color-mix(in srgb, var(--primary) 20%, transparent)";
const CTA_SHADOW_HOVER = "0 6px 16px color-mix(in srgb, var(--primary) 30%, transparent)";

// Mitigazione T-07-11: i campi evento interpolati nel popup HTML arrivano dagli
// scraper e vanno resi inerti prima di entrare nel template string.
function escapeHtml(text: string): string {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

// Unica lettura dei token a runtime: chiamata dentro addEventLayers (invocata
// dall'handler "load"/"style.load", mai a livello di modulo o al solo mount).
function readThemeColors() {
	const style = getComputedStyle(document.documentElement);
	const get = (name: string) => style.getPropertyValue(name).trim();
	return {
		accent: get("--accent"),
		primary: get("--primary"),
		primaryHover: get("--primary-hover"),
		surface: get("--surface"),
		primaryForeground: get("--primary-foreground"),
		foreground: get("--foreground"),
		mutedForeground: get("--muted-foreground"),
		accentTint: get("--accent-tint"),
		muted: get("--muted"),
		userLocation: get("--user-location"),
	};
}

// Aggiunge solo source "events" + i tre layer, coi colori letti a runtime.
// Non registra gestori di eventi (map.on): quelli sopravvivono a setStyle()
// e vengono registrati una sola volta altrove (handlersRegisteredRef).
function addEventLayers(map: mapboxgl.Map, geojsonData: GeoJSON.FeatureCollection) {
	const colors = readThemeColors();

	map.addSource("events", {
		type: "geojson",
		data: geojsonData,
		cluster: true,
		clusterMaxZoom: 14,
		clusterRadius: 50,
	});

	// Layer per i cluster
	map.addLayer({
		id: "clusters",
		type: "circle",
		source: "events",
		filter: ["has", "point_count"],
		paint: {
			"circle-color": [
				"step",
				["get", "point_count"],
				colors.accent, // 1-10 eventi
				10,
				colors.primary, // 10-30 eventi
				30,
				colors.primaryHover, // 30+ eventi
			],
			"circle-radius": [
				"step",
				["get", "point_count"],
				20, // < 10
				10,
				30, // 10-30
				30,
				40, // 30+
			],
			"circle-stroke-width": 3,
			"circle-stroke-color": colors.surface,
		},
	});

	// Layer per il contatore nei cluster
	map.addLayer({
		id: "cluster-count",
		type: "symbol",
		source: "events",
		filter: ["has", "point_count"],
		layout: {
			"text-field": "{point_count_abbreviated}",
			"text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
			"text-size": 14,
		},
		paint: {
			"text-color": colors.primaryForeground,
		},
	});

	// Layer per i singoli punti
	map.addLayer({
		id: "unclustered-point",
		type: "circle",
		source: "events",
		filter: ["!", ["has", "point_count"]],
		paint: {
			"circle-color": colors.primary,
			"circle-radius": 8,
			"circle-stroke-width": 2,
			"circle-stroke-color": colors.surface,
		},
	});
}

export default function EventsMap({
	events,
	initialGeoJSON,
	onEventClick,
	disablePopups = false,
	userLocation,
}: EventsMapProps) {
	const mapContainerRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<mapboxgl.Map | null>(null);
	const popupRef = useRef<mapboxgl.Popup | null>(null);
	const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
	const eventsWithCoordsRef = useRef<Array<{event: Event; coords: {lat: number; lng: number}}>>([]);
	const layersInitializedRef = useRef(false);
	const handlersRegisteredRef = useRef(false);
	const lastGeoJSONRef = useRef<GeoJSON.FeatureCollection | null>(null);
	const [isThemeTransitioning, setIsThemeTransitioning] = useState(false);

	useEffect(() => {
		if (!mapContainerRef.current) return;

		// Inizializza la mappa
		mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

		// Lo script anti-FOUC applica .dark su <html> prima dell'idratazione,
		// quindi questa lettura al mount è affidabile (Pitfall 2 di 07-RESEARCH.md).
		const initialStyle = document.documentElement.classList.contains("dark")
			? MAP_STYLE_DARK
			: MAP_STYLE_LIGHT;

		mapRef.current = new mapboxgl.Map({
			container: mapContainerRef.current,
			style: initialStyle,
			center: [9.1859, 45.4654], // [lng, lat] - Milano
			zoom: 8,
			touchZoomRotate: true,
			touchPitch: false,
		});

		// Aggiungi controlli zoom
		mapRef.current.addControl(new mapboxgl.NavigationControl(), "top-right");

		mapRef.current.on("load", () => {
			// Il source verrà aggiornato nell'effetto degli eventi
		});

		return () => {
			mapRef.current?.remove();
			mapRef.current = null;
		};
	}, []);

	// Reagisci al cambio tema: scambia lo style Mapbox e ri-aggiungi source/layer
	// dentro style.load, mostrando un velo finché i marker non sono tornati.
	useEffect(() => {
		const handleThemeChange = () => {
			const map = mapRef.current;
			if (!map) return;

			const isDark = document.documentElement.classList.contains("dark");
			setIsThemeTransitioning(true);
			map.setStyle(isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT);
			// Dopo setStyle() source e layer non esistono più (comportamento
			// documentato di Mapbox GL, non un difetto del progetto).
			layersInitializedRef.current = false;

			map.once("style.load", () => {
				addEventLayers(map, lastGeoJSONRef.current ?? EMPTY_GEOJSON);
				layersInitializedRef.current = true;
				setIsThemeTransitioning(false);
			});
		};

		window.addEventListener("theme-change", handleThemeChange);
		return () => window.removeEventListener("theme-change", handleThemeChange);
	}, []);

	// Aggiorna i marker quando cambiano gli eventi
	useEffect(() => {
		if (!mapRef.current) return;

		const updateMarkers = () => {
			if (!mapRef.current) return;

			// Chiudi popup esistenti
			if (popupRef.current) {
				popupRef.current.remove();
				popupRef.current = null;
			}

			// Compute events with coordinates for bounds fitting (always needed)
			const eventsWithCoords = events
				.map((event) => {
					const coords = getEventCoordinates(event);
					return coords ? { event, coords } : null;
				})
				.filter(
					(
						item
					): item is { event: Event; coords: { lat: number; lng: number } } =>
						item !== null
				);

			// Aggiorna il ref con i dati più recenti (per i gestori di eventi)
			eventsWithCoordsRef.current = eventsWithCoords;

			// Use pre-cached cluster data when available (no active filters)
			// HomeClient passes null initialGeoJSON when filters are active
			let geojsonData: GeoJSON.FeatureCollection;

			if (initialGeoJSON && initialGeoJSON.features.length > 0) {
				geojsonData = initialGeoJSON;
			} else {
				// Crea GeoJSON features from current events (un feature per evento - Mapbox gestirà il clustering)
				geojsonData = {
					type: "FeatureCollection",
					features: eventsWithCoords.map((item) => ({
						type: "Feature",
						geometry: {
							type: "Point",
							coordinates: [item.coords.lng, item.coords.lat],
						},
						properties: {
							id: item.event.id,
							title: item.event.title,
							description: item.event.description || "",
							dateStart: item.event.dateStart,
							locationName: item.event.locationName || "",
							category: item.event.category || "",
							imageUrl: item.event.imageUrl || "",
						},
					})),
				};
			}

			// Conserva l'ultimo GeoJSON: serve a ri-aggiungere i layer dopo uno
			// scambio di style senza ricalcolare le coordinate.
			lastGeoJSONRef.current = geojsonData;

			// Verifica se source e layers esistono già
			const sourceExists = mapRef.current.getSource("events");

			if (sourceExists && layersInitializedRef.current) {
				// Aggiornamento incrementale: usa setData() per evitare il blink
				(mapRef.current.getSource("events") as mapboxgl.GeoJSONSource).setData(geojsonData);
			} else {
				// Prima inizializzazione: aggiungi source + layers
				addEventLayers(mapRef.current, geojsonData);
				layersInitializedRef.current = true;
			}

			// I gestori sopravvivono a un cambio di style: registrarli di nuovo
			// dopo un setStyle li duplicherebbe, facendo scattare due volte ogni click.
			if (!handlersRegisteredRef.current) {
				// Click sui cluster per zoom
				const handleClusterClick = (
					e: mapboxgl.MapLayerMouseEvent | mapboxgl.MapLayerTouchEvent
				) => {
					if (!mapRef.current) return;
					const features = mapRef.current.queryRenderedFeatures(e.point, {
						layers: ["clusters"],
					});
					const clusterId = features[0].properties?.cluster_id;
					const source = mapRef.current.getSource(
						"events"
					) as mapboxgl.GeoJSONSource;

					source.getClusterExpansionZoom(clusterId, (err, zoom) => {
						if (err || !mapRef.current || zoom === null || zoom === undefined)
							return;
						const coordinates = (features[0].geometry as GeoJSON.Point)
							.coordinates as [number, number];
						mapRef.current.easeTo({
							center: coordinates,
							zoom: zoom,
						});
					});
				};

				mapRef.current.on("click", "clusters", handleClusterClick);
				mapRef.current.on("touchend", "clusters", handleClusterClick);

				// Popup per i singoli punti (solo se non disabilitati)
				if (!disablePopups) {
					const handleMarkerClick = (
						e: mapboxgl.MapLayerMouseEvent | mapboxgl.MapLayerTouchEvent
					) => {
						if (!mapRef.current || !e.features?.[0] || !e.features[0].properties)
							return;

						// Chiudi eventuali popup esistenti
						if (popupRef.current) {
							popupRef.current.remove();
							popupRef.current = null;
						}

						const coordinates = (
							e.features[0].geometry as GeoJSON.Point
						).coordinates.slice() as [number, number];
						const props = e.features[0].properties;

						// Ora ogni feature ha solo 1 evento
						const event = {
							id: props.id,
							title: props.title,
							description: props.description || "",
							dateStart: props.dateStart,
							locationName: props.locationName || "",
							category: props.category || "",
							imageUrl: props.imageUrl || "",
						};

						// Colori letti prima di costruire il template: le classi Tailwind
						// non arrivano dentro l'HTML di un popup Mapbox.
						const colors = readThemeColors();

						// Escaping (mitigazione T-07-11): i campi evento arrivano dagli
						// scraper, senza escaping un titolo con markup verrebbe eseguito nel popup.
						const safeTitle = escapeHtml(event.title);
						const safeLocationName = event.locationName ? escapeHtml(event.locationName) : "";
						const safeCategory = event.category ? escapeHtml(event.category) : "";
						const safeImageUrl = event.imageUrl ? escapeHtml(event.imageUrl) : "";
						const safeId = escapeHtml(String(event.id));

						// Popup in stile card per singolo evento
						const popupContent = `
					<div style="width: 280px; font-family: system-ui, -apple-system, sans-serif; padding: 16px; position: relative;">
						<div>
							${
								safeImageUrl
									? `<img src="${safeImageUrl}" alt="${safeTitle}" style="width: 100%; height: 120px; object-fit: cover; border-radius: var(--r-lg); margin-bottom: 12px;" />`
									: `<div style="width: 100%; height: 120px; background: ${colors.muted}; border-radius: var(--r-lg); margin-bottom: 12px; display: flex; align-items: center; justify-content: center;">
										<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${colors.primary}" stroke-width="2">
											<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
											<line x1="16" y1="2" x2="16" y2="6"></line>
											<line x1="8" y1="2" x2="8" y2="6"></line>
											<line x1="3" y1="10" x2="21" y2="10"></line>
										</svg>
									</div>`
							}
							<h3 style="font-weight: 600; font-size: 14px; color: ${colors.foreground}; margin: 0 0 6px 0; line-height: 1.3;">${safeTitle}</h3>
							${
								safeLocationName
									? `<p style="font-size: 12px; color: ${colors.foreground}; margin: 0 0 4px 0; font-weight: 500;">${safeLocationName}</p>`
									: ""
							}
							<p style="font-size: 12px; color: ${colors.mutedForeground}; margin: 0 0 6px 0;">
								${format(new Date(event.dateStart), "dd MMM", { locale: it })}
							</p>
							${
								safeCategory
									? `<span style="display: inline-block; padding: 4px 10px; background: ${colors.accentTint}; color: ${colors.primary}; border-radius: var(--r-lg); font-size: 11px; font-weight: 600; margin-bottom: 12px;">${safeCategory}</span>`
									: ""
							}
							<a
								href="/eventi/${safeId}"
								style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 12px 16px; background: ${colors.primary}; color: ${colors.primaryForeground}; font-weight: 600; border-radius: var(--r-xl); text-decoration: none; font-size: 13px; margin-top: 12px; transition: all 0.2s; box-shadow: ${CTA_SHADOW};"
								onmouseover="this.style.boxShadow='${CTA_SHADOW_HOVER}'"
								onmouseout="this.style.boxShadow='${CTA_SHADOW}'"
							>
								Vedi dettagli
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M5 12h14M12 5l7 7-7 7"/>
								</svg>
							</a>
						</div>
					</div>
				`;

						const popup = new mapboxgl.Popup({
							closeButton: false,
							closeOnClick: true,
							maxWidth: "280px",
							className: "custom-popup",
						})
							.setLngLat(coordinates)
							.setHTML(popupContent)
							.addTo(mapRef.current);

						// Salva il riferimento al popup corrente
						popupRef.current = popup;

						// Aggiungi bottone chiudi custom con icona X
						const popupElement = popup.getElement();
						if (popupElement) {
							const closeButton = document.createElement("button");
							closeButton.className = "custom-popup-close";
							closeButton.innerHTML = `
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
							<line x1="18" y1="6" x2="6" y2="18"></line>
							<line x1="6" y1="6" x2="18" y2="18"></line>
						</svg>
					`;
							const closePopup = (e: MouseEvent | TouchEvent) => {
								e.preventDefault();
								e.stopPropagation();
								popup.remove();
								popupRef.current = null;
							};
							closeButton.addEventListener("click", closePopup as EventListener);
							closeButton.addEventListener("touchend", closePopup as EventListener);
							const content = popupElement.querySelector(
								".mapboxgl-popup-content"
							) as HTMLElement;
							if (content) {
								content.style.position = "relative";
								content.appendChild(closeButton);
							}
						}

						// Se c'è callback, chiamalo - usa eventsWithCoordsRef per i dati più recenti
						if (onEventClick) {
							const eventWithCoords = eventsWithCoordsRef.current.find(
								(item) => item.event.id === event.id
							);
							if (eventWithCoords) onEventClick(eventWithCoords.event);
						}
					};

					// Aggiungi listener per click e touch
					mapRef.current.on("click", "unclustered-point", handleMarkerClick);
					mapRef.current.on("touchend", "unclustered-point", handleMarkerClick);
				}

				// Cambia cursore su hover
				mapRef.current.on("mouseenter", "clusters", () => {
					if (mapRef.current) mapRef.current.getCanvas().style.cursor = "pointer";
				});
				mapRef.current.on("mouseleave", "clusters", () => {
					if (mapRef.current) mapRef.current.getCanvas().style.cursor = "";
				});

				if (!disablePopups) {
					mapRef.current.on("mouseenter", "unclustered-point", () => {
						if (mapRef.current)
							mapRef.current.getCanvas().style.cursor = "pointer";
					});
					mapRef.current.on("mouseleave", "unclustered-point", () => {
						if (mapRef.current) mapRef.current.getCanvas().style.cursor = "";
					});
				}

				// Marca i gestori come registrati: mai riportato a false, sopravvivono a setStyle()
				handlersRegisteredRef.current = true;
			}

			// Adatta la vista per includere tutti gli eventi (sempre, non solo prima inizializzazione)
			if (eventsWithCoords.length > 0 && mapRef.current) {
				const bounds = new mapboxgl.LngLatBounds();
				eventsWithCoords.forEach((item) => {
					bounds.extend([item.coords.lng, item.coords.lat]);
				});
				mapRef.current.fitBounds(bounds, { padding: 50, maxZoom: 12 });
			}
		};

		// Aspetta che la mappa sia caricata
		if (mapRef.current.isStyleLoaded()) {
			updateMarkers();
		} else {
			mapRef.current.once("load", updateMarkers);
		}
	}, [events, initialGeoJSON, onEventClick, disablePopups]);

	// Gestisci marker della posizione dell'utente
	useEffect(() => {
		if (!mapRef.current || !userLocation) return;

		// Rimuovi marker esistente se presente
		if (userMarkerRef.current) {
			userMarkerRef.current.remove();
		}

		// Crea elemento custom per il marker dell'utente
		const el = document.createElement("div");
		el.className = "user-location-marker";
		el.style.width = "24px";
		el.style.height = "24px";
		el.style.borderRadius = "50%";
		// Il blu resta identico nei due temi di proposito: convenzione di
		// piattaforma per "sei qui", non va rimappato sul teal di marca.
		el.style.backgroundColor = "var(--user-location)";
		el.style.border = "3px solid var(--surface)";
		el.style.boxShadow =
			"0 0 0 3px color-mix(in srgb, var(--user-location) 30%, transparent), 0 2px 8px rgba(0, 0, 0, 0.2)";
		el.style.cursor = "default";

		// Aggiungi pulse animation
		const pulse = document.createElement("div");
		pulse.style.position = "absolute";
		pulse.style.top = "-6px";
		pulse.style.left = "-6px";
		pulse.style.width = "36px";
		pulse.style.height = "36px";
		pulse.style.borderRadius = "50%";
		pulse.style.backgroundColor = "color-mix(in srgb, var(--user-location) 30%, transparent)";
		pulse.style.animation = "pulse 2s infinite";
		el.appendChild(pulse);

		// Crea il marker
		const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
			.setLngLat([userLocation.lng, userLocation.lat])
			.addTo(mapRef.current);

		userMarkerRef.current = marker;

		// Cleanup
		return () => {
			if (userMarkerRef.current) {
				userMarkerRef.current.remove();
				userMarkerRef.current = null;
			}
		};
	}, [userLocation]);

	return (
		<div className="relative w-full h-full">
			<div ref={mapContainerRef} className="w-full h-full" />
			{isThemeTransitioning && (
				<div
					className="absolute inset-0 bg-surface pointer-events-none"
					aria-hidden="true"
				/>
			)}
		</div>
	);
}
