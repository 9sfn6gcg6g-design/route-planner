'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet'
import type { LatLon } from '@/lib/engine/types'

const toLatLng = (p: LatLon): [number, number] => [p.lat, p.lon]

/** Keep the chosen route framed as the selection changes. */
function FitBounds({ points }: { points: LatLon[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    map.fitBounds(points.map(toLatLng), { padding: [24, 24] })
  }, [map, points])
  return null
}

export default function RouteMap({ start, route }: { start: LatLon; route: LatLon[] }) {
  return (
    <MapContainer
      center={toLatLng(start)}
      zoom={14}
      scrollWheelZoom
      className="h-80 w-full rounded-xl"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Polyline positions={route.map(toLatLng)} pathOptions={{ color: '#2563eb', weight: 5 }} />
      <CircleMarker
        center={toLatLng(start)}
        radius={7}
        pathOptions={{ color: '#052e16', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }}
      />
      <FitBounds points={route.length > 0 ? route : [start]} />
    </MapContainer>
  )
}
