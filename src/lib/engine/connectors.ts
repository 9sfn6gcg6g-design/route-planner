import type { LatLon } from './types'

const ORS_DIRECTIONS_URL =
  'https://api.openrouteservice.org/v2/directions/foot-walking/geojson'

export interface FootRoute {
  points: LatLon[]
  lengthMeters: number
}

export function buildDirectionsBody(
  from: LatLon,
  to: LatLon,
): { coordinates: [number, number][] } {
  return {
    coordinates: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
  }
}

export function buildRoundTripBody(
  start: LatLon,
  lengthMeters: number,
  seed = 1,
): {
  coordinates: [number, number][]
  options: { round_trip: { length: number; points: number; seed: number } }
} {
  return {
    coordinates: [[start.lon, start.lat]],
    options: { round_trip: { length: lengthMeters, points: 3, seed } },
  }
}

interface OrsFeature {
  properties?: { summary?: { distance?: number } }
  geometry?: { coordinates?: [number, number][] }
}

export function parseOrsResponse(body: unknown): FootRoute {
  if (typeof body !== 'object' || body === null) {
    throw new Error('ORS response has no features array')
  }
  const features = (body as { features?: unknown }).features
  if (!Array.isArray(features) || features.length === 0) {
    throw new Error('ORS response has no features array')
  }
  const feature = features[0] as OrsFeature
  const coordinates = feature.geometry?.coordinates
  const distance = feature.properties?.summary?.distance
  if (!Array.isArray(coordinates) || coordinates.length < 2 || typeof distance !== 'number') {
    throw new Error('ORS feature is missing geometry coordinates or summary distance')
  }
  return {
    points: coordinates.map(([lon, lat]) => ({ lat, lon })),
    lengthMeters: distance,
  }
}

/** I/O glue — composition of tested parts; not unit-tested. */
async function postOrs(apiKey: string, body: unknown): Promise<FootRoute> {
  const response = await fetch(ORS_DIRECTIONS_URL, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`ORS request failed: ${response.status}`)
  }
  return parseOrsResponse(await response.json())
}

/** I/O glue — not unit-tested. */
export async function fetchFootRoute(apiKey: string, from: LatLon, to: LatLon): Promise<FootRoute> {
  return postOrs(apiKey, buildDirectionsBody(from, to))
}

/** I/O glue — not unit-tested. */
export async function fetchRoundTrip(
  apiKey: string,
  start: LatLon,
  lengthMeters: number,
  seed = 1,
): Promise<FootRoute> {
  return postOrs(apiKey, buildRoundTripBody(start, lengthMeters, seed))
}
