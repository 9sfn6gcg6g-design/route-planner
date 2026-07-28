import type { LatLon } from './types'
import { haversineMeters } from './geo'

/**
 * Re-space a polyline to a fixed interval by linear interpolation. Raw OSM
 * geometry has ~7m median spacing; summing |Δelevation| at that density
 * against a ~90m DEM manufactures gradient noise, so elevation sampling
 * happens on resampled geometry. The final point is always kept.
 */
export function resamplePoints(points: LatLon[], intervalMeters: number): LatLon[] {
  if (!Number.isFinite(intervalMeters) || intervalMeters <= 0) {
    throw new Error('intervalMeters must be a positive number')
  }
  if (points.length < 2) return [...points]

  const result: LatLon[] = [points[0]]
  let sinceLast = 0
  for (let i = 1; i < points.length; i++) {
    let from = points[i - 1]
    const to = points[i]
    let remaining = haversineMeters(from, to)
    while (sinceLast + remaining >= intervalMeters) {
      const needed = intervalMeters - sinceLast
      const t = needed / remaining
      const next = {
        lat: from.lat + (to.lat - from.lat) * t,
        lon: from.lon + (to.lon - from.lon) * t,
      }
      result.push(next)
      from = next
      remaining -= needed
      sinceLast = 0
    }
    sinceLast += remaining
  }
  const last = points[points.length - 1]
  const tail = result[result.length - 1]
  if (tail.lat !== last.lat || tail.lon !== last.lon) result.push(last)
  return result
}
