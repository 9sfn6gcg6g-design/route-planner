import type { LatLon } from './types'
import type { FootRoute } from './connectors'
import { haversineMeters } from './geo'

export interface WorkGeometry {
  points: LatLon[]
  meters: number
  passes: number
}

export interface RoutePhaseSpan {
  kind: 'warmup' | 'work' | 'cooldown'
  startIndex: number
  endIndex: number
  meters: number
}

export interface AssembledRoute {
  points: LatLon[]
  totalMeters: number
  phases: RoutePhaseSpan[]
}

/**
 * Lay the work distance onto a segment: back-and-forth passes on a stretch
 * (odd pass count ends at the far end), forward laps on a cycle. Rounds to
 * the nearest whole pass, minimum one — a session overshoots or undershoots
 * by at most half a pass.
 */
export function buildWorkGeometry(
  segment: { points: LatLon[]; lengthMeters: number; isCycle: boolean },
  targetMeters: number,
): WorkGeometry {
  if (!Number.isFinite(targetMeters) || targetMeters <= 0) {
    throw new Error('targetMeters must be a positive number')
  }
  const passes = Math.max(1, Math.round(targetMeters / segment.lengthMeters))
  const points: LatLon[] = [...segment.points]
  for (let pass = 1; pass < passes; pass++) {
    const forward = segment.isCycle || pass % 2 === 0
    const next = forward ? segment.points : [...segment.points].reverse()
    points.push(...next.slice(1))
  }
  return { points, meters: segment.lengthMeters * passes, passes }
}

/** Rotate a closed ring so it starts at the point nearest the target. */
export function rotateRingToNearest(ring: LatLon[], target: LatLon): LatLon[] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (ring.length < 4 || first.lat !== last.lat || first.lon !== last.lon) {
    throw new Error('rotateRingToNearest requires a closed ring')
  }
  const open = ring.slice(0, -1)
  let bestIndex = 0
  let bestDistance = Infinity
  open.forEach((point, i) => {
    const d = haversineMeters(point, target)
    if (d < bestDistance) {
      bestDistance = d
      bestIndex = i
    }
  })
  const rotated = [...open.slice(bestIndex), ...open.slice(0, bestIndex)]
  rotated.push(rotated[0])
  return rotated
}

export function assembleRoute(
  warmup: FootRoute,
  work: WorkGeometry,
  cooldown: FootRoute,
): AssembledRoute {
  const points: LatLon[] = [...warmup.points]
  const phases: RoutePhaseSpan[] = [
    { kind: 'warmup', startIndex: 0, endIndex: points.length - 1, meters: warmup.lengthMeters },
  ]
  const workStart = points.length
  points.push(...work.points)
  phases.push({ kind: 'work', startIndex: workStart, endIndex: points.length - 1, meters: work.meters })
  const coolStart = points.length
  points.push(...cooldown.points)
  phases.push({ kind: 'cooldown', startIndex: coolStart, endIndex: points.length - 1, meters: cooldown.lengthMeters })
  return {
    points,
    totalMeters: warmup.lengthMeters + work.meters + cooldown.lengthMeters,
    phases,
  }
}

/** Easy/long loops have no connectors: the whole loop is the work phase. */
export function assembleLoopRoute(loop: FootRoute): AssembledRoute {
  return {
    points: [...loop.points],
    totalMeters: loop.lengthMeters,
    phases: [
      { kind: 'work', startIndex: 0, endIndex: loop.points.length - 1, meters: loop.lengthMeters },
    ],
  }
}
