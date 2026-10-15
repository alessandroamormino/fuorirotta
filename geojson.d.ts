// I tipi di mapbox-gl (dalla 3.2x) usano il namespace globale `GeoJSON` senza
// caricarlo: senza questo riferimento EventsMap e clusterCache non compilano.
/// <reference types="geojson" />
