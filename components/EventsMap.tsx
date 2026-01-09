'use client'

import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { Event } from '@/lib/types'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { getEventCoordinates } from '@/lib/cityCoordinates'

interface EventsMapProps {
  events: Event[]
  onEventClick?: (event: Event) => void
  mapId?: string
  disablePopups?: boolean
  userLocation?: { lat: number; lng: number } | null
}

export default function EventsMap({ events, onEventClick, disablePopups = false, userLocation }: EventsMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const popupRef = useRef<mapboxgl.Popup | null>(null)
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null)

  useEffect(() => {
    if (!mapContainerRef.current) return

    // Inizializza la mappa
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

    mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [9.1859, 45.4654], // [lng, lat] - Milano
      zoom: 8,
    })

    // Aggiungi controlli zoom
    mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

    mapRef.current.on('load', () => {
      // Il source verrà aggiornato nell'effetto degli eventi
    })

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Aggiorna i marker quando cambiano gli eventi
  useEffect(() => {
    if (!mapRef.current) return

    const updateMarkers = () => {
      if (!mapRef.current) return

      // Chiudi popup esistenti
      if (popupRef.current) {
        popupRef.current.remove()
        popupRef.current = null
      }

      // Ottieni coordinate per ogni evento (usa città come fallback)
      const eventsWithCoords = events
        .map((event) => {
          const coords = getEventCoordinates(event)
          return coords ? { event, coords } : null
        })
        .filter((item): item is { event: Event; coords: { lat: number; lng: number } } => item !== null)

    // Crea GeoJSON features (un feature per evento - Mapbox gestirà il clustering)
    const geojsonData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: eventsWithCoords.map((item) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [item.coords.lng, item.coords.lat],
        },
        properties: {
          id: item.event.id,
          title: item.event.title,
          description: item.event.description || '',
          dateStart: item.event.dateStart,
          locationName: item.event.locationName || '',
          category: item.event.category || '',
          imageUrl: item.event.imageUrl || '',
        },
      })),
    }

      // Rimuovi source esistente se presente
      if (mapRef.current.getSource('events')) {
        if (mapRef.current.getLayer('clusters')) mapRef.current.removeLayer('clusters')
        if (mapRef.current.getLayer('cluster-count')) mapRef.current.removeLayer('cluster-count')
        if (mapRef.current.getLayer('unclustered-point')) mapRef.current.removeLayer('unclustered-point')
        mapRef.current.removeSource('events')
      }

      // Aggiungi source con clustering
      mapRef.current.addSource('events', {
      type: 'geojson',
      data: geojsonData,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    })

      // Layer per i cluster
      mapRef.current.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'events',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          '#83c5be', // 1-10 eventi
          10,
          '#006d77', // 10-30 eventi
          30,
          '#00565e', // 30+ eventi
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          20, // < 10
          10,
          30, // 10-30
          30,
          40, // 30+
        ],
        'circle-stroke-width': 3,
        'circle-stroke-color': '#fff',
      },
    })

      // Layer per il contatore nei cluster
      mapRef.current.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'events',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 14,
      },
      paint: {
        'text-color': '#ffffff',
      },
    })

      // Layer per i singoli punti
      mapRef.current.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: 'events',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': '#006d77',
        'circle-radius': 8,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
      },
    })

      // Click sui cluster per zoom
      mapRef.current.on('click', 'clusters', (e) => {
      if (!mapRef.current) return
      const features = mapRef.current.queryRenderedFeatures(e.point, {
        layers: ['clusters'],
      })
      const clusterId = features[0].properties?.cluster_id
      const source = mapRef.current.getSource('events') as mapboxgl.GeoJSONSource

      source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err || !mapRef.current || zoom === null || zoom === undefined) return
        const coordinates = (features[0].geometry as GeoJSON.Point).coordinates as [number, number]
        mapRef.current.easeTo({
          center: coordinates,
          zoom: zoom,
        })
      })
    })

      // Popup per i singoli punti (solo se non disabilitati)
      if (!disablePopups) {
        mapRef.current.on('click', 'unclustered-point', (e) => {
        if (!mapRef.current || !e.features?.[0] || !e.features[0].properties) return

        // Chiudi eventuali popup esistenti
        if (popupRef.current) {
          popupRef.current.remove()
          popupRef.current = null
        }

        const coordinates = (e.features[0].geometry as GeoJSON.Point).coordinates.slice() as [number, number]
        const props = e.features[0].properties

        // Ora ogni feature ha solo 1 evento
        const event = {
          id: props.id,
          title: props.title,
          description: props.description || '',
          dateStart: props.dateStart,
          locationName: props.locationName || '',
          category: props.category || '',
          imageUrl: props.imageUrl || '',
        }

      // Popup in stile card per singolo evento
      const popupContent = `
        <div style="width: 280px; font-family: system-ui, -apple-system, sans-serif; padding: 16px; position: relative;">
          <div>
            ${event.imageUrl
              ? `<img src="${event.imageUrl}" alt="${event.title}" style="width: 100%; height: 120px; object-fit: cover; border-radius: 12px; margin-bottom: 12px;" />`
              : `<div style="width: 100%; height: 120px; background: linear-gradient(135deg, #edf6f9 0%, #83c5be 100%); border-radius: 12px; margin-bottom: 12px; display: flex; align-items: center; justify-content: center;">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#006d77" stroke-width="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                </div>`
            }
            <h3 style="font-weight: 600; font-size: 14px; color: #111; margin: 0 0 6px 0; line-height: 1.3;">${event.title}</h3>
            ${event.locationName
              ? `<p style="font-size: 12px; color: #111; margin: 0 0 4px 0; font-weight: 500;">${event.locationName}</p>`
              : ''
            }
            <p style="font-size: 12px; color: #666; margin: 0 0 6px 0;">
              ${format(new Date(event.dateStart), 'dd MMM', { locale: it })}
            </p>
            ${event.category
              ? `<span style="display: inline-block; padding: 4px 10px; background: #edf6f9; color: #006d77; border-radius: 12px; font-size: 11px; font-weight: 600; margin-bottom: 12px;">${event.category}</span>`
              : ''
            }
            <a
              href="/eventi/${event.id}"
              style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 12px 16px; background: linear-gradient(to right, #006d77, #83c5be); color: white; font-weight: 600; border-radius: 16px; text-decoration: none; font-size: 13px; margin-top: 12px; transition: all 0.2s; box-shadow: 0 4px 12px rgba(0, 109, 119, 0.2);"
              onmouseover="this.style.boxShadow='0 6px 16px rgba(0, 109, 119, 0.3)'"
              onmouseout="this.style.boxShadow='0 4px 12px rgba(0, 109, 119, 0.2)'"
            >
              Vedi dettagli
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </a>
          </div>
        </div>
      `

      const popup = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: true,
        maxWidth: '280px',
        className: 'custom-popup'
      })
        .setLngLat(coordinates)
        .setHTML(popupContent)
        .addTo(mapRef.current)

      // Salva il riferimento al popup corrente
      popupRef.current = popup

      // Aggiungi bottone chiudi custom con icona X
      const popupElement = popup.getElement()
      if (popupElement) {
        const closeButton = document.createElement('button')
        closeButton.className = 'custom-popup-close'
        closeButton.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        `
        closeButton.onclick = () => {
          popup.remove()
          popupRef.current = null
        }
        const content = popupElement.querySelector('.mapboxgl-popup-content') as HTMLElement
        if (content) {
          content.style.position = 'relative'
          content.appendChild(closeButton)
        }
      }

      // Se c'è callback, chiamalo
      if (onEventClick) {
        const eventWithCoords = eventsWithCoords.find(item => item.event.id === event.id)
        if (eventWithCoords) onEventClick(eventWithCoords.event)
      }
    })
      }

      // Cambia cursore su hover
      mapRef.current.on('mouseenter', 'clusters', () => {
        if (mapRef.current) mapRef.current.getCanvas().style.cursor = 'pointer'
      })
      mapRef.current.on('mouseleave', 'clusters', () => {
        if (mapRef.current) mapRef.current.getCanvas().style.cursor = ''
      })

      if (!disablePopups) {
        mapRef.current.on('mouseenter', 'unclustered-point', () => {
          if (mapRef.current) mapRef.current.getCanvas().style.cursor = 'pointer'
        })
        mapRef.current.on('mouseleave', 'unclustered-point', () => {
          if (mapRef.current) mapRef.current.getCanvas().style.cursor = ''
        })
      }

      // Adatta la vista per includere tutti gli eventi
      if (eventsWithCoords.length > 0 && mapRef.current) {
        const bounds = new mapboxgl.LngLatBounds()
        eventsWithCoords.forEach((item) => {
          bounds.extend([item.coords.lng, item.coords.lat])
        })
        mapRef.current.fitBounds(bounds, { padding: 50, maxZoom: 12 })
      }
    }

    // Aspetta che la mappa sia caricata
    if (mapRef.current.isStyleLoaded()) {
      updateMarkers()
    } else {
      mapRef.current.once('load', updateMarkers)
    }
  }, [events, onEventClick, disablePopups])

  // Gestisci marker della posizione dell'utente
  useEffect(() => {
    if (!mapRef.current || !userLocation) return

    // Rimuovi marker esistente se presente
    if (userMarkerRef.current) {
      userMarkerRef.current.remove()
    }

    // Crea elemento custom per il marker dell'utente
    const el = document.createElement('div')
    el.className = 'user-location-marker'
    el.style.width = '24px'
    el.style.height = '24px'
    el.style.borderRadius = '50%'
    el.style.backgroundColor = '#3B82F6'
    el.style.border = '3px solid white'
    el.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.3), 0 2px 8px rgba(0, 0, 0, 0.2)'
    el.style.cursor = 'default'

    // Aggiungi pulse animation
    const pulse = document.createElement('div')
    pulse.style.position = 'absolute'
    pulse.style.top = '-6px'
    pulse.style.left = '-6px'
    pulse.style.width = '36px'
    pulse.style.height = '36px'
    pulse.style.borderRadius = '50%'
    pulse.style.backgroundColor = 'rgba(59, 130, 246, 0.3)'
    pulse.style.animation = 'pulse 2s infinite'
    el.appendChild(pulse)

    // Crea il marker
    const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([userLocation.lng, userLocation.lat])
      .addTo(mapRef.current)

    userMarkerRef.current = marker

    // Cleanup
    return () => {
      if (userMarkerRef.current) {
        userMarkerRef.current.remove()
        userMarkerRef.current = null
      }
    }
  }, [userLocation])

  return <div ref={mapContainerRef} className="w-full h-full" />
}
