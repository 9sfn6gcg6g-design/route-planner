import type { EasySession, LongSession, SessionPlan } from '@/lib/domain/types'
import { compileSession } from '@/lib/domain/compiler'
import { buildGraph } from '@/lib/engine/graph'
import { findLoop } from '@/lib/engine/loop'
import type { LoopRoute } from '@/lib/engine/loop'
import { snapToNode } from '@/lib/engine/route'
import type { LatLon, OsmWay } from '@/lib/engine/types'

/**
 * Composition root for conversational door-to-door loops (v1.1 slice D):
 * compile the session, fetch a distance-scaled patch of map, and assemble a
 * loop from the door of roughly the session distance. Tempo joins once slice
 * C's work-stretch-in-loop assembly exists; structured sessions keep the
 * stretch flow. All I/O is injected so tests pass fakes and no network is hit.
 */
export interface PlanLoopDeps {
  /** Fetch runnable OSM ways within `radiusMeters` of `center`. */
  fetchWays: (center: LatLon, radiusMeters: number) => Promise<OsmWay[]>
}

export interface LoopPlan {
  plan: SessionPlan
  loop: LoopRoute
  targetMeters: number
}

/** The network around the door cannot host a loop of the asked distance. */
export class LoopUnreachableError extends Error {}

const RADIUS_MIN_METERS = 1200
const RADIUS_MAX_METERS = 3500
/** A loop of length L needs reach of roughly L/5 (a circle of circumference L
 *  has radius L/2π ≈ L/6.3; real street loops are less round). */
const RADIUS_SHARE = 5

/** OSM fetch radius for a loop of `targetMeters`: v1's default 1200, scaled up
 *  for longer sessions and clamped to keep Overpass queries answerable. */
export function loopSearchRadiusMeters(targetMeters: number): number {
  return Math.min(RADIUS_MAX_METERS, Math.max(RADIUS_MIN_METERS, targetMeters / RADIUS_SHARE))
}

export async function planLoop(
  session: EasySession | LongSession,
  start: LatLon,
  deps: PlanLoopDeps,
): Promise<LoopPlan> {
  const plan = compileSession(session)
  const targetMeters = plan.totalMeters

  const ways = await deps.fetchWays(start, loopSearchRadiusMeters(targetMeters))
  const graph = buildGraph(ways)
  const snapped = snapToNode(graph, start)
  if (snapped === null) {
    throw new LoopUnreachableError('no runnable ways near the start point')
  }
  const loop = findLoop(graph, snapped.nodeId, targetMeters)
  if (loop === null) {
    throw new LoopUnreachableError(
      `the street network within ${loopSearchRadiusMeters(targetMeters)}m cannot host a ${targetMeters}m loop`,
    )
  }
  return { plan, loop, targetMeters }
}
