// Coordinate delle città della Lombardia
export const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  'Milano': { lat: 45.4642, lng: 9.1900 },
  'Bergamo': { lat: 45.6983, lng: 9.6773 },
  'Brescia': { lat: 45.5416, lng: 10.2118 },
  'Como': { lat: 45.8081, lng: 9.0852 },
  'Cremona': { lat: 45.1335, lng: 10.0227 },
  'Lecco': { lat: 45.8536, lng: 9.3943 },
  'Lodi': { lat: 45.3142, lng: 9.5034 },
  'Mantova': { lat: 45.1564, lng: 10.7914 },
  'Monza': { lat: 45.5845, lng: 9.2744 },
  'Pavia': { lat: 45.1847, lng: 9.1582 },
  'Sondrio': { lat: 46.1699, lng: 9.8782 },
  'Varese': { lat: 45.8206, lng: 8.8251 }
}

// Trova coordinate per un evento basandosi sulla città
export function getEventCoordinates(event: {
  latitude: number | null
  longitude: number | null
  locationName: string | null
}): { lat: number; lng: number } | null {
  // Se ha già coordinate valide, usale
  if (event.latitude && event.longitude) {
    // Verifica che siano numeri validi
    if (!isNaN(event.latitude) && !isNaN(event.longitude) && isFinite(event.latitude) && isFinite(event.longitude)) {
      return { lat: event.latitude, lng: event.longitude }
    }
  }

  // Altrimenti cerca coordinate della città
  if (event.locationName) {
    const locationLower = event.locationName.toLowerCase()

    for (const [city, coords] of Object.entries(CITY_COORDINATES)) {
      const cityLower = city.toLowerCase()

      // Match esatto o città contenuta nel nome
      if (locationLower === cityLower || locationLower.includes(cityLower)) {
        return coords
      }
    }
  }

  return null
}
