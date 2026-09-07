"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Event } from "@/lib/types";
import { CATEGORY_VISUALS, type CategoryVisual } from "@/lib/categories/visuals";
import { FALLBACK_CATEGORY, type CanonicalCategory } from "@/lib/categories/taxonomy";
import { calculateDistanceKm } from "@/lib/territorial/distance";
import MapPopupCard, { type MapPopupEvent } from "@/components/map/MapPopupCard";

export interface MapViewportChange {
	/** Id delle feature non raggruppate renderizzate nell'inquadratura corrente. */
	ids: number[];
	/**
	 * Eventi REALMENTE in vista: i pin singoli piu' quelli chiusi dentro i
	 * cluster (`point_count`). Non coincide con `ids.length` — un cluster e'
	 * una feature sola che ne rappresenta N, e a zoom basso e' tutto cluster.
	 * Contare i soli `unclustered-point` dava "0 eventi in vista" su tutta la
	 * Lombardia (difetto riportato dall'utente il 2026-09-07).
	 */
	totalInView: number;
	center: { lat: number; lng: number };
	/** Distanza centro -> angolo nord-est dei bounds correnti. */
	radiusKm: number;
}

interface EventsMapProps {
	events: Event[];
	initialGeoJSON?: GeoJSON.FeatureCollection;
	onEventClick?: (event: Event) => void;
	mapId?: string;
	disablePopups?: boolean;
	userLocation?: { lat: number; lng: number } | null;
	/** Contratto per il legame bidirezionale lista<->mappa (12-06). */
	selectedEventId?: number | null;
	onEventSelect?: (id: number | null) => void;
	onViewportChange?: (change: MapViewportChange) => void;
}

const MAP_STYLE_LIGHT = "mapbox://styles/mapbox/light-v11";
const MAP_STYLE_DARK = "mapbox://styles/mapbox/dark-v11";

// Diametro coerente col pin 34px del prototipo (raggio ~ meta').
const PIN_CIRCLE_RADIUS = 15;
const PIN_HALO_RADIUS = 23;
const PIN_HALO_OPACITY = 0.22;
// Dimensione sorgente dell'SVG rasterizzato per addImage; l'icona resa a
// schermo scende a CATEGORY_ICON_TARGET_PX via icon-size.
const CATEGORY_ICON_SOURCE_PX = 24;
const CATEGORY_ICON_TARGET_PX = 17;

const EMPTY_GEOJSON: GeoJSON.FeatureCollection = {
	type: "FeatureCollection",
	features: [],
};

// Unica lettura dei token a runtime: chiamata dentro addEventLayers (invocata
// dall'handler "load"/"style.load", mai a livello di modulo o al solo mount).
function readThemeColors() {
	const style = getComputedStyle(document.documentElement);
	const get = (name: string) => style.getPropertyValue(name).trim();

	const categoryColors: Record<string, string> = {};
	(Object.values(CATEGORY_VISUALS) as CategoryVisual[]).forEach((visual) => {
		categoryColors[visual.token] = get(visual.token);
	});

	return {
		primary: get("--primary"),
		surface: get("--surface"),
		primaryForeground: get("--primary-foreground"),
		foreground: get("--foreground"),
		background: get("--background"),
		categoryColors,
	};
}

type ThemeColors = ReturnType<typeof readThemeColors>;

function categoryIconImageId(token: string): string {
	return `category-icon${token}`;
}

// Un'espressione "match" sulla proprieta' "category" gia' presente nel
// GeoJSON, con Altro come ramo di default: nessuna informazione passa dal
// solo colore (D-10), la mappa colore/icona e' l'unica fonte (nessuna lista
// locale da tenere allineata a lib/categories/visuals.ts).
function buildCategoryColorMatch(colors: ThemeColors): unknown[] {
	const expr: unknown[] = ["match", ["get", "category"]];
	(Object.entries(CATEGORY_VISUALS) as [CanonicalCategory, CategoryVisual][]).forEach(([name, visual]) => {
		if (name === FALLBACK_CATEGORY) return;
		expr.push(name, colors.categoryColors[visual.token]);
	});
	expr.push(colors.categoryColors[CATEGORY_VISUALS[FALLBACK_CATEGORY].token]);
	return expr;
}

function buildIconImageMatch(): unknown[] {
	const expr: unknown[] = ["match", ["get", "category"]];
	(Object.entries(CATEGORY_VISUALS) as [CanonicalCategory, CategoryVisual][]).forEach(([name, visual]) => {
		if (name === FALLBACK_CATEGORY) return;
		expr.push(name, categoryIconImageId(visual.token));
	});
	expr.push(categoryIconImageId(CATEGORY_VISUALS[FALLBACK_CATEGORY].token));
	return expr;
}

// Il pin selezionato sovrascrive il colore di categoria con --primary pieno
// (ramo "case" in testa): un ramo che non matcha mai quando non c'e'
// selezione, cosi' l'espressione degrada all'esatto match per categoria.
function buildCircleColorExpression(colors: ThemeColors, selectedEventId: number | null | undefined): unknown {
	const categoryMatch = buildCategoryColorMatch(colors);
	if (selectedEventId == null) return categoryMatch;
	return ["case", ["==", ["get", "id"], selectedEventId], colors.primary, categoryMatch];
}

// Registra le 7 icone di categoria come immagini SDF (una volta per ciclo di
// style: addImage/hasImage guardano lo stato dello style corrente, che
// setStyle() azzera insieme ai layer). SDF = Mapbox ricolora via icon-color
// invece di richiedere sette immagini gia' colorate: zero esadecimali nel
// sorgente (check:tokens li rifiuterebbe comunque).
function registerCategoryIcons(map: mapboxgl.Map) {
	(Object.values(CATEGORY_VISUALS) as CategoryVisual[]).forEach(({ token, Icon }) => {
		const imageId = categoryIconImageId(token);
		if (map.hasImage(imageId)) return;

		const svgMarkup = renderToStaticMarkup(
			<Icon width={CATEGORY_ICON_SOURCE_PX} height={CATEGORY_ICON_SOURCE_PX} color="black" strokeWidth={2.4} />
		);
		const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;

		map.loadImage(dataUrl, (error, image) => {
			if (error || !image) return;
			if (!map.hasImage(imageId)) {
				map.addImage(imageId, image, { sdf: true });
			}
		});
	});
}

// Aggiunge source "events" + i layer (cluster, pin, alone di selezione,
// icone di categoria), coi colori letti a runtime. Non registra gestori di
// eventi (map.on): quelli sopravvivono a setStyle() e vengono registrati una
// sola volta altrove (handlersRegisteredRef).
function addEventLayers(
	map: mapboxgl.Map,
	geojsonData: GeoJSON.FeatureCollection,
	selectedEventId: number | null | undefined
) {
	const colors = readThemeColors();

	map.addSource("events", {
		type: "geojson",
		data: geojsonData,
		cluster: true,
		clusterMaxZoom: 14,
		clusterRadius: 50,
	});

	registerCategoryIcons(map);

	// Layer per i cluster. D-13: solo l'aspetto del prototipo (cerchio su
	// --foreground, testo su --background, anello di distacco dal fondo) —
	// non piu' un colore diverso per fascia di conteggio, solo il raggio varia.
	map.addLayer({
		id: "clusters",
		type: "circle",
		source: "events",
		filter: ["has", "point_count"],
		paint: {
			"circle-color": colors.foreground,
			"circle-opacity": 0.92,
			"circle-radius": ["step", ["get", "point_count"], 20, 10, 30, 30, 40],
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
			"text-color": colors.background,
		},
	});

	// Alone di selezione (D-04/prototipo): sotto il pin, invisibile finche'
	// nessun id combacia col filtro. setFilter() lo riattiva/spegne senza
	// ricostruire il layer (effect dipendente da selectedEventId sotto).
	map.addLayer({
		id: "unclustered-point-halo",
		type: "circle",
		source: "events",
		filter: ["==", ["get", "id"], selectedEventId ?? -1],
		paint: {
			"circle-radius": PIN_HALO_RADIUS,
			"circle-color": colors.primary,
			"circle-opacity": PIN_HALO_OPACITY,
		},
	});

	// Layer per i singoli punti: colore + icona per categoria (D-10), il
	// selezionato passa a --primary pieno (buildCircleColorExpression).
	map.addLayer({
		id: "unclustered-point",
		type: "circle",
		source: "events",
		filter: ["!", ["has", "point_count"]],
		paint: {
			"circle-color": buildCircleColorExpression(colors, selectedEventId) as never,
			"circle-radius": PIN_CIRCLE_RADIUS,
			"circle-stroke-width": 2,
			"circle-stroke-color": colors.surface,
		},
	});

	// Icona di categoria sopra il pin (D-10): stesso filtro, senza point_count.
	map.addLayer({
		id: "unclustered-point-icon",
		type: "symbol",
		source: "events",
		filter: ["!", ["has", "point_count"]],
		layout: {
			"icon-image": buildIconImageMatch() as never,
			"icon-size": CATEGORY_ICON_TARGET_PX / CATEGORY_ICON_SOURCE_PX,
			"icon-allow-overlap": true,
			"icon-ignore-placement": true,
		},
		paint: {
			// Token del testo su pin pieno: leggibile sia sul colore di
			// categoria sia sul --primary del pin selezionato.
			"icon-color": colors.primaryForeground,
		},
	});
}

export default function EventsMap({
	events,
	initialGeoJSON,
	onEventClick,
	disablePopups = false,
	userLocation,
	selectedEventId = null,
	onEventSelect,
	onViewportChange,
}: EventsMapProps) {
	const mapContainerRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<mapboxgl.Map | null>(null);
	const popupRef = useRef<mapboxgl.Popup | null>(null);
	const popupRootRef = useRef<Root | null>(null);
	const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
	const eventsWithCoordsRef = useRef<Array<{ event: Event; coords: { lat: number; lng: number } }>>([]);
	const layersInitializedRef = useRef(false);
	const handlersRegisteredRef = useRef(false);
	const lastGeoJSONRef = useRef<GeoJSON.FeatureCollection | null>(null);
	const selectedEventIdRef = useRef<number | null>(selectedEventId);
	// Refs per i callback opzionali del contratto 12-06: i gestori Mapbox si
	// registrano una sola volta (handlersRegisteredRef), quindi un callback
	// letto per closure resterebbe quello della prima registrazione. Le ref
	// si aggiornano a ogni render, cosi' l'handler legge sempre l'ultimo.
	const onEventClickRef = useRef(onEventClick);
	const onEventSelectRef = useRef(onEventSelect);
	const onViewportChangeRef = useRef(onViewportChange);
	const [isThemeTransitioning, setIsThemeTransitioning] = useState(false);

	useEffect(() => {
		onEventClickRef.current = onEventClick;
	}, [onEventClick]);
	useEffect(() => {
		onEventSelectRef.current = onEventSelect;
	}, [onEventSelect]);
	useEffect(() => {
		onViewportChangeRef.current = onViewportChange;
	}, [onViewportChange]);
	useEffect(() => {
		selectedEventIdRef.current = selectedEventId;
	}, [selectedEventId]);

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
			popupRootRef.current?.unmount();
			popupRootRef.current = null;
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
			// Dopo setStyle() source, layer e immagini non esistono più
			// (comportamento documentato di Mapbox GL, non un difetto del progetto).
			layersInitializedRef.current = false;

			map.once("style.load", () => {
				addEventLayers(map, lastGeoJSONRef.current ?? EMPTY_GEOJSON, selectedEventIdRef.current);
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

			// Chiudi popup esistenti — root React incluso, altrimenti resta
			// collegato a un nodo DOM staccato a ogni aggiornamento eventi.
			if (popupRootRef.current) {
				popupRootRef.current.unmount();
				popupRootRef.current = null;
			}
			if (popupRef.current) {
				popupRef.current.remove();
				popupRef.current = null;
			}

			// Compute events with coordinates for bounds fitting (always needed).
			// Il punto e' gia' stato risolto a scrittura dal backfill territoriale
			// (D-09/D-14, Fase 6): include il centroide del comune per gli eventi
			// senza coordinate proprie. Il client non calcola più nessun fallback,
			// legge solo resolvedLatitude/resolvedLongitude — la stessa colonna
			// letta dal GeoJSON precalcolato in lib/clusterCache.ts, cosi' gli
			// eventi non si spostano a seconda che ci siano filtri attivi o no.
			const eventsWithCoords = events
				.map((event) => {
					if (event.resolvedLatitude == null || event.resolvedLongitude == null) {
						return null;
					}
					return {
						event,
						coords: { lat: event.resolvedLatitude, lng: event.resolvedLongitude },
					};
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
							dateEnd: item.event.dateEnd || "",
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
				addEventLayers(mapRef.current, geojsonData, selectedEventIdRef.current);
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
						if (!mapRef.current || !e.features?.length) return;

						// D-18: TUTTE le feature coincidenti, non solo la prima.
						// Deduplica per id (sopra una certa densita' Mapbox puo'
						// restituire la stessa feature piu' volte a cavallo di piu'
						// tile) e ordina per dateStart crescente.
						const seenIds = new Set<number>();
						const popupEvents: MapPopupEvent[] = [];
						// Coordinate di tutte le feature coincidenti per definizione
						// (D-18): presa dalla prima feature incontrata nel ciclo,
						// senza indicizzare l'array esplicitamente per indice.
						let coordinates: [number, number] | null = null;
						for (const feature of e.features) {
							if (coordinates === null) {
								coordinates = (feature.geometry as GeoJSON.Point).coordinates.slice() as [
									number,
									number,
								];
							}
							const props = feature.properties;
							if (!props || props.id == null) continue;
							const id = Number(props.id);
							if (seenIds.has(id)) continue;
							seenIds.add(id);
							popupEvents.push({
								id,
								title: props.title ?? "",
								category: props.category || "",
								imageUrl: props.imageUrl || "",
								locationName: props.locationName || "",
								dateStart: props.dateStart,
								dateEnd: props.dateEnd || undefined,
							});
						}
						if (popupEvents.length === 0 || coordinates === null) return;
						popupEvents.sort(
							(a, b) => new Date(a.dateStart).getTime() - new Date(b.dateStart).getTime()
						);

						// Smonta SEMPRE il root precedente prima di crearne uno nuovo:
						// altrimenti ogni click su un marker diverso lascia un root
						// React montato su un nodo ormai staccato dal DOM (leak
						// silenzioso, nessun errore a schermo — Pitfall 2 di
						// 12-RESEARCH.md).
						popupRootRef.current?.unmount();
						popupRootRef.current = null;
						if (popupRef.current) {
							popupRef.current.remove();
							popupRef.current = null;
						}

						const container = document.createElement("div");
						const root = createRoot(container);
						popupRootRef.current = root;

						const popup = new mapboxgl.Popup({
							closeButton: false,
							closeOnClick: true,
							maxWidth: "280px",
						}).setLngLat(coordinates);

						// root.render() SINCRONO, PRIMA di passare il container a
						// Mapbox: invertire l'ordine riproduce il popup vuoto al
						// primo click documentato nell'issue mapbox-gl-js n. 12653.
						root.render(<MapPopupCard events={popupEvents} onClose={() => popup.remove()} />);

						popup.setDOMContent(container).addTo(mapRef.current);
						popupRef.current = popup;

						// Percorso di smontaggio quando l'utente clicca altrove sulla
						// mappa: nessuno dei rami sopra viene attraversato in quel caso.
						popup.on("close", () => {
							popupRootRef.current?.unmount();
							popupRootRef.current = null;
							if (popupRef.current === popup) {
								popupRef.current = null;
							}
						});

						if (onEventSelectRef.current) {
							onEventSelectRef.current(popupEvents[0].id);
						}

						// Callback esistente: continua a ricevere il primo evento
						// dell'elenco ordinato, i chiamanti attuali non cambiano
						// comportamento. La selezione fine passa da onEventSelect.
						if (onEventClickRef.current) {
							const eventWithCoords = eventsWithCoordsRef.current.find(
								(item) => item.event.id === popupEvents[0].id
							);
							if (eventWithCoords) onEventClickRef.current(eventWithCoords.event);
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

				// Conteggio "eventi in vista" + centro/raggio dell'inquadratura
				// (12-06): stesso innesco moveend, una callback sola perche' le tre
				// cose condividono origine e momento.
				mapRef.current.on("moveend", () => {
					const map = mapRef.current;
					if (!map || !onViewportChangeRef.current) return;
					if (!map.getLayer("unclustered-point")) return;

					const rendered = map.queryRenderedFeatures({ layers: ["unclustered-point"] });
					const idSet = new Set<number>();
					rendered.forEach((feature) => {
						const id = feature.properties?.id;
						if (typeof id === "number") idSet.add(id);
						else if (id != null) idSet.add(Number(id));
					});

					// Il totale in vista somma i pin singoli e il point_count di ogni
					// cluster renderizzato: a zoom basso i singoli sono ZERO e tutto il
					// contenuto vive dentro i cluster. Il layer puo' non esistere (nessun
					// cluster a zoom alto), quindi la query e' guardata.
					let clusteredCount = 0;
					if (map.getLayer("clusters")) {
						map.queryRenderedFeatures({ layers: ["clusters"] }).forEach((feature) => {
							const n = Number(feature.properties?.point_count ?? 0);
							if (Number.isFinite(n)) clusteredCount += n;
						});
					}
					const totalInView = idSet.size + clusteredCount;

					const center = map.getCenter();
					const bounds = map.getBounds();
					if (!bounds) return;
					const northEast = bounds.getNorthEast();
					const radiusKm = calculateDistanceKm(center.lat, center.lng, northEast.lat, northEast.lng);

					onViewportChangeRef.current({
						ids: Array.from(idSet),
						totalInView,
						center: { lat: center.lat, lng: center.lng },
						radiusKm,
					});
				});

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

		// Aspetta che la mappa sia caricata. "load" e' one-shot per l'intera vita
		// della mappa: se questo effect gira mentre isStyleLoaded() e' falso DOPO
		// che il load iniziale e' gia' avvenuto, once("load", ...) non scatta mai
		// piu' e l'aggiornamento va perso in silenzio — la causa dell'intermittenza
		// misurata al checkpoint di 11-05-PLAN.md (Difetto A). "idle" si ripete a
		// ogni giro, quindi non ha questo limite.
		if (mapRef.current.isStyleLoaded()) {
			updateMarkers();
		} else {
			mapRef.current.once("idle", updateMarkers);
		}

		// Rimuove un handler "idle" ancora in coda quando un run piu' recente di
		// questo stesso effect parte prima che sia scattato: senza questo cleanup
		// updateMarkers cattura `events` per closure, e l'handler vecchio
		// sovrascriverebbe la mappa con dati ormai superati non appena l'idle
		// arriva.
		return () => {
			mapRef.current?.off("idle", updateMarkers);
		};
	}, [events, initialGeoJSON, disablePopups]);

	// Aggiorna il pin selezionato: --primary pieno + alone, senza aspettare il
	// prossimo giro di updateMarkers. Nessun feature-state: l'espressione
	// "case" letta a ogni set basta e non richiede di sincronizzare stato per
	// feature.
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !layersInitializedRef.current) return;
		if (!map.getLayer("unclustered-point")) return;

		const colors = readThemeColors();
		map.setPaintProperty(
			"unclustered-point",
			"circle-color",
			buildCircleColorExpression(colors, selectedEventId) as never
		);
		if (map.getLayer("unclustered-point-halo")) {
			map.setFilter("unclustered-point-halo", ["==", ["get", "id"], selectedEventId ?? -1]);
		}
	}, [selectedEventId]);

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
