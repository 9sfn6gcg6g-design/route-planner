import type { LatLon } from './types'

const ELEVATION_ENDPOINT = 'https://api.open-meteo.com/v1/elevation'

/** Open-Meteo accepts at most 100 coordinates per request. */
const MAX_COORDS_PER_REQUEST = 100

export function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size))
  }
  return batches
}

export function buildElevationUrl(points: LatLon[]): string {
  const latitude = points.map((p) => p.lat).join(',')
  const longitude = points.map((p) => p.lon).join(',')
  return `${ELEVATION_ENDPOINT}?latitude=${latitude}&longitude=${longitude}`
}

export function parseElevationResponse(body: unknown, expectedCount: number): number[] {
  const elevation = (body as { elevation?: unknown }).elevation
  if (!Array.isArray(elevation) || elevation.some((e) => typeof e !== 'number')) {
    throw new Error('Open-Meteo response has no elevation array')
  }
  if (elevation.length !== expectedCount) {
    throw new Error(`Open-Meteo returned ${elevation.length} elevations, expected ${expectedCount}`)
  }
  return elevation as number[]
}

/**
 * Mean |gradient| in percent across the path: total absolute climb+descent
 * divided by total distance. `cumulative` is running distance in meters
 * (from cumulativeMeters), same length as `elevations`.
 */
export function avgAbsGradientPercent(elevations: number[], cumulative: number[]): number {
  if (elevations.length !== cumulative.length) {
    throw new Error('elevations and cumulative distances must have the same length')
  }
  if (elevations.length < 2) return 0
  const totalDistance = cumulative[cumulative.length - 1] - cumulative[0]
  if (totalDistance <= 0) return 0
  let totalAbsRise = 0
  for (let i = 1; i < elevations.length; i++) {
    totalAbsRise += Math.abs(elevations[i] - elevations[i - 1])
  }
  return (totalAbsRise / totalDistance) * 100
}

/** I/O glue — composition of tested parts; not unit-tested. */
export async function fetchElevations(points: LatLon[]): Promise<number[]> {
  const results: number[] = []
  for (const batch of chunk(points, MAX_COORDS_PER_REQUEST)) {
    const response = await fetch(buildElevationUrl(batch))
    if (!response.ok) {
      throw new Error(`Open-Meteo request failed: ${response.status}`)
    }
    results.push(...parseElevationResponse(await response.json(), batch.length))
  }
  return results
}
