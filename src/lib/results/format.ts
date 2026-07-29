import type { Session } from '@/lib/domain/types'

/** Presentation helpers for route results. Pure and unit-tested; the UI stays thin. */

export function sessionSummary(session: Session): string {
  switch (session.type) {
    case 'easy':
      return `Easy ${formatKm(session.distanceMeters)}`
    case 'long':
      return `Long ${formatKm(session.distanceMeters)}`
    case 'tempo':
      return `Tempo ${formatKm(session.tempoMeters)}`
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
      return `tempo-${km(session.tempoMeters)}km`
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
