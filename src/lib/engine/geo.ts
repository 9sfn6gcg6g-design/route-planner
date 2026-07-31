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

/** Initial great-circle bearing from a to b, degrees clockwise from north. */
export function bearingDegrees(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const dLon = toRadians(b.lon - a.lon)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Smallest angle between two compass bearings, in [0, 180]. */
export function angularDifferenceDegrees(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export type TurnClass = 'straight' | 'left' | 'right' | 'back'

/**
 * Signed heading change from an arrival bearing to a departure bearing, in
 * (-180, 180]. Negative is a left turn (anticlockwise), positive a right turn
 * (clockwise) — bearings run clockwise from north, so turning right increases
 * the heading.
 */
export function signedTurnDegrees(arrivalBearing: number, departureBearing: number): number {
  return ((departureBearing - arrivalBearing + 540) % 360) - 180
}

/**
 * Classify a continuation through a junction as a left/right turn, a
 * straight-through (a road crossing, in stretch terms — decision 15), or a
 * `back` U-turn we never take. `straightMax` is the half-width of the straight
 * cone; a turn sharper than `backMin` is a doubling-back.
 */
export function classifyTurn(
  arrivalBearing: number,
  departureBearing: number,
  straightMax = 45,
  backMin = 135,
): TurnClass {
  const turn = signedTurnDegrees(arrivalBearing, departureBearing)
  const magnitude = Math.abs(turn)
  if (magnitude <= straightMax) return 'straight'
  if (magnitude >= backMin) return 'back'
  return turn < 0 ? 'left' : 'right'
}

/** Turns gentler than this cost no pace and don't count as navigational turns. */
export const GENTLE_TURN_DEGREES = 30
/** Turns this sharp (a hairpin) score zero smoothness. */
export const SHARP_TURN_DEGREES = 135
/** Navigational turns per km at which the turn-density score decays to zero. */
export const TURN_DENSITY_ZERO_PER_KM = 8

/**
 * 0–1 smoothness of a single turn by its magnitude (decision 18): a gentle
 * sweep costs no pace (1), a hairpin costs the most (0), linear between the
 * gentle and sharp bounds. Sign is irrelevant — a left and right of equal
 * magnitude are equally smooth.
 */
export function turnSmoothness(signedTurnDegrees: number): number {
  const magnitude = Math.abs(signedTurnDegrees)
  if (magnitude <= GENTLE_TURN_DEGREES) return 1
  if (magnitude >= SHARP_TURN_DEGREES) return 0
  return 1 - (magnitude - GENTLE_TURN_DEGREES) / (SHARP_TURN_DEGREES - GENTLE_TURN_DEGREES)
}

/**
 * Aggregate the turns a stretch takes (decision 18) into two 0–1 flow
 * sub-scores: `turnSmoothness` is the mean per-turn smoothness (1 when it takes
 * no turns), so one hairpin drags a stretch down; `turnDensity` is 1 for a
 * legible line and decays with the number of *navigational* turns per km (gentle
 * sweeps below the threshold don't count), reaching 0 at
 * `TURN_DENSITY_ZERO_PER_KM`. Both feed the quality blend, weighted per session.
 */
export function turnFlowScores(
  turnAngles: number[],
  lengthMeters: number,
): { turnSmoothness: number; turnDensity: number } {
  const smoothness =
    turnAngles.length === 0
      ? 1
      : turnAngles.reduce((sum, a) => sum + turnSmoothness(a), 0) / turnAngles.length
  const navigational = turnAngles.filter((a) => Math.abs(a) > GENTLE_TURN_DEGREES).length
  const perKm = lengthMeters > 0 ? navigational / (lengthMeters / 1000) : 0
  const turnDensity = Math.max(0, 1 - perKm / TURN_DENSITY_ZERO_PER_KM)
  return { turnSmoothness: smoothness, turnDensity }
}
