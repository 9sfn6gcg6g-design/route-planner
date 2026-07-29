import type { LatLon } from './types'
import { chunk } from './elevation'

/**
 * Open-Elevation fallback sampler: keyless and CORS-open like the terrain
 * tiles, but community-run and less reliable — used as a failover provider,
 * never the primary. https://open-elevation.com
 */
const OPEN_ELEVATION_ENDPOINT = 'https://api.open-elevation.com/api/v1/lookup'

/** Conservative batch size; the public instance accepts larger but is unbothered by 100. */
const MAX_LOCATIONS_PER_REQUEST = 100

export interface OpenElevationBody {
  locations: Array<{ latitude: number; longitude: number }>
}

export function buildOpenElevationBody(points: LatLon[]): OpenElevationBody {
  return {
    locations: points.map((p) => ({ latitude: p.lat, longitude: p.lon })),
  }
}

export function parseOpenElevationResponse(body: unknown, expectedCount: number): number[] {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Open-Elevation response has no results array')
  }
  const results = (body as { results?: unknown }).results
  if (!Array.isArray(results)) {
    throw new Error('Open-Elevation response has no results array')
  }
  const elevations = results.map((entry) => (entry as { elevation?: unknown }).elevation)
  if (elevations.some((e) => typeof e !== 'number')) {
    throw new Error('Open-Elevation response has non-numeric elevations')
  }
  if (elevations.length !== expectedCount) {
    throw new Error(
      `Open-Elevation returned ${elevations.length} elevations, expected ${expectedCount}`,
    )
  }
  return elevations as number[]
}

/** I/O glue — composition of tested parts; not unit-tested. */
export async function fetchOpenElevations(points: LatLon[]): Promise<number[]> {
  const results: number[] = []
  for (const batch of chunk(points, MAX_LOCATIONS_PER_REQUEST)) {
    const response = await fetch(OPEN_ELEVATION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOpenElevationBody(batch)),
    })
    if (!response.ok) {
      throw new Error(`Open-Elevation request failed: ${response.status}`)
    }
    results.push(...parseOpenElevationResponse(await response.json(), batch.length))
  }
  return results
}
