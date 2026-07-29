import type { Session, SessionPlan } from '@/lib/domain/types'
import { compileSession } from '@/lib/domain/compiler'
import type { LatLon, OsmWay } from './types'
import type { FootRoute } from './connectors'
import { assembleLoopRoute, assembleRoute, buildWorkGeometry, rotateRingToNearest } from './assemble'
import type { AssembledRoute } from './assemble'
import { buildGraph } from './graph'
import { findWorkSegments, type ElevationSampler, type WorkSegment } from './finder'
import { toGpx } from './gpx'

export interface RoutePlanDeps {
  fetchWays(center: LatLon, radiusMeters: number): Promise<OsmWay[]>
  sampleElevations: ElevationSampler
  fetchFootRoute(from: LatLon, to: LatLon): Promise<FootRoute>
  fetchRoundTrip(start: LatLon, lengthMeters: number): Promise<FootRoute>
}

export interface GenerateOptions {
  maxDistanceFromStartMeters?: number
  maxResults?: number
}

export interface GeneratedRoute {
  sessionPlan: SessionPlan
  route: AssembledRoute
  gpx: string
  /** The chosen work segment; null for loop (easy/long) routes. */
  segment: WorkSegment | null
}

function describeSession(session: Session): string {
  switch (session.type) {
    case 'easy':
      return `Easy run ${(session.distanceMeters / 1000).toFixed(1)}k`
    case 'long':
      return `Long run ${(session.distanceMeters / 1000).toFixed(1)}k`
    case 'tempo':
      return `Tempo ${(session.tempoMeters / 1000).toFixed(1)}k`
    case 'intervals':
      return `Intervals ${session.reps}x${session.repMeters}m`
    case 'hills':
      return `Hill reps ${session.reps}x${session.hillMeters}m`
  }
}

/**
 * The engine's front door: a session and a start point in, a routed,
 * GPX-ready course out. Easy/long runs become ORS round-trip loops (known
 * limitation: the round trip does not see our quietness/surface signals);
 * tempo/intervals/hills find a work segment, lap it, and connect it to the
 * runner's door. The Overpass fetch radius always exceeds the prefilter
 * radius by the stretch requirement so boundary clipping cannot silently
 * reject qualifying chains.
 */
export async function generateRoute(
  session: Session,
  start: LatLon,
  deps: RoutePlanDeps,
  options: GenerateOptions = {},
): Promise<GeneratedRoute> {
  const sessionPlan = compileSession(session)
  const name = describeSession(session)

  if (session.type === 'easy' || session.type === 'long') {
    const loop = await deps.fetchRoundTrip(start, sessionPlan.totalMeters)
    const route = assembleLoopRoute(loop)
    return { sessionPlan, route, gpx: toGpx(route, name), segment: null }
  }

  const workPhase = sessionPlan.phases.find((p) => p.kind === 'work')
  if (!workPhase || !workPhase.requirements) {
    throw new Error('session plan has no work phase with requirements')
  }
  const maxDistance = options.maxDistanceFromStartMeters ?? 2000
  const fetchRadius =
    maxDistance + Math.max(1000, workPhase.requirements.minUninterruptedMeters ?? 0)
  const ways = await deps.fetchWays(start, fetchRadius)
  const graph = buildGraph(ways)
  const segments = await findWorkSegments(
    graph,
    start,
    workPhase.requirements,
    deps.sampleElevations,
    { maxDistanceFromStartMeters: maxDistance, maxResults: options.maxResults ?? 5 },
  )
  if (segments.length === 0) {
    throw new Error('No suitable work segment found near the start point')
  }
  const segment = segments[0]
  const workPoints = segment.isCycle ? rotateRingToNearest(segment.points, start) : segment.points
  const work = buildWorkGeometry(
    { points: workPoints, lengthMeters: segment.lengthMeters, isCycle: segment.isCycle },
    workPhase.targetMeters,
  )
  const entry = work.points[0]
  const exit = work.points[work.points.length - 1]
  const warmup = await deps.fetchFootRoute(start, entry)
  const cooldown = await deps.fetchFootRoute(exit, start)
  const route = assembleRoute(warmup, work, cooldown)
  return { sessionPlan, route, gpx: toGpx(route, name), segment }
}
