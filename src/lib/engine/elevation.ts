import type { LatLon } from './types'

const ELEVATION_ENDPOINT = 'https://api.open-meteo.com/v1/elevation'

/** Open-Meteo accepts at most 100 coordinates per request. */
const MAX_COORDS_PER_REQUEST = 100

export function chunk<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`chunk size must be a positive integer, got ${size}`)
  }
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
  if (typeof body !== 'object' || body === null) {
    throw new Error('Open-Meteo response has no elevation array')
  }
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

/**
 * 0–1 gradient consistency (decision 19): |net elevation change| / total
 * absolute rise. 1 when the profile moves in one direction — a sustained climb,
 * or steady ground — and toward 0 when it rolls up and down. This is what tells
 * a hill rep's single sustained climb apart from rolling ground that only
 * *averages* to the target gradient (the two share an `avgAbsGradientPercent`).
 * A flat profile has no vertical movement and is perfectly consistent (1).
 */
export function gradientConsistency(elevations: number[]): number {
  if (elevations.length < 2) return 1
  let totalAbsRise = 0
  for (let i = 1; i < elevations.length; i++) {
    totalAbsRise += Math.abs(elevations[i] - elevations[i - 1])
  }
  if (totalAbsRise === 0) return 1
  const net = Math.abs(elevations[elevations.length - 1] - elevations[0])
  return net / totalAbsRise
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
