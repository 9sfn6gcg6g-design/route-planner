import type { LatLon } from './types'

const EARTH_RADIUS_METERS = 6_371_000

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLon = toRadians(b.lon - a.lon)
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h =
    sinLat * sinLat +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinLon * sinLon
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h))
}

export function pathLengthMeters(points: LatLon[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversineMeters(points[i - 1], points[i])
  }
  return total
}

/** Running distance from the first point to each point, same length as input. */
export function cumulativeMeters(points: LatLon[]): number[] {
  const cum: number[] = []
  let total = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0) total += haversineMeters(points[i - 1], points[i])
    cum.push(total)
  }
  return cum
}
