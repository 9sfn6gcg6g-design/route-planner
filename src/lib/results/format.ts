import type { Session } from '@/lib/domain/types'

/** Presentation helpers for route results. Pure and unit-tested; the UI stays thin. */

export function sessionSummary(session: Session): string {
  switch (session.type) {
    case 'easy':
      return `Easy ${formatKm(session.distanceMeters)}`
    case 'long':
      return `Long ${formatKm(session.distanceMeters)}`
    case 'tempo':
      return session.reps === 1
        ? `Tempo ${formatKm(session.tempoMeters)}`
        : `${session.reps} × ${formatKm(session.tempoMeters)} tempo`
    case 'intervals':
      return `${session.reps} × ${session.repMeters}m intervals (${session.recovery} recovery)`
    case 'hills':
      return `${session.reps} × ${session.hillMeters}m hills`
  }
}

function sessionSlug(session: Session): string {
  const km = (meters: number): number => Math.round(meters / 1000)
  switch (session.type) {
    case 'easy':
      return `easy-${km(session.distanceMeters)}km`
    case 'long':
      return `long-${km(session.distanceMeters)}km`
    case 'tempo':
      return session.reps === 1
        ? `tempo-${km(session.tempoMeters)}km`
        : `${session.reps}x${km(session.tempoMeters)}km-tempo`
    case 'intervals':
      return `${session.reps}x${session.repMeters}m-intervals`
    case 'hills':
      return `${session.reps}x${session.hillMeters}m-hills`
  }
}

export function gpxFileName(session: Session): string {
  return `route-${sessionSlug(session)}.gpx`
}

/** Meters → "8.0 km". */
export function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`
}

/** Quietness/other 0–1 score → "90%". */
export function formatPercent01(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** Gradient percent → "3.4%". */
export function formatGradient(percent: number): string {
  return `${percent.toFixed(1)}%`
}

/** 0–1 overall segment quality → "87%" (decision 16). */
export function formatQuality(value: number): string {
  return formatPercent01(value)
}

/** Target pace in seconds/km → "5:10/km" (decision 13; formatted at the edge). */
export function formatPace(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}/km`
}

/**
 * Caveat for a stretch that couldn't stay crossing-free (decision 15):
 * "Crosses 2 roads", or null when the stretch is crossing-free.
 */
export function crossingCaveat(crossings: number): string | null {
  if (crossings <= 0) return null
  return `Crosses ${crossings} ${crossings === 1 ? 'road' : 'roads'}`
}
