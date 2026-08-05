import type {
  CompilerConfig,
  PhasePlan,
  Session,
  SessionPlan,
  TerrainRequirements,
} from '@/lib/domain/types'
import { compileSession } from '@/lib/domain/compiler'
import { buildGraph } from '@/lib/engine/graph'
import { findWorkSegments } from '@/lib/engine/finder'
import type { ElevationSampler, WorkSegment } from '@/lib/engine/finder'
import type { OverpassData } from '@/lib/engine/overpass'
import type { LatLon } from '@/lib/engine/types'

/**
 * Composition root for route generation: compile the session, then find the
 * ground its work phase demands near the start point. This is the one module
 * allowed to import functions from both `domain` and `engine` (see AGENTS.md
 * Layering) — everything below stays decoupled. All I/O is injected so tests
 * pass fakes and no network is hit.
 */
export interface PlanRouteDeps {
  /** Fetch runnable OSM ways + blocking barrier nodes within `radiusMeters`. */
  fetchWays: (center: LatLon, radiusMeters: number) => Promise<OverpassData>
  /** Sample ground elevation (meters) at each point, in order. */
  sampleElevations: ElevationSampler
}

export interface PlanRouteOptions {
  /** OSM fetch radius and finder prefilter radius, meters. Default 1200 — a lighter
   *  Overpass query is far less likely to be throttled (429/504); callers widen it
   *  when the first pass finds nothing. */
  searchRadiusMeters?: number
  /** Cap on returned segments. Defaults to the finder's own default. */
  maxResults?: number
  /** Passed through to the compiler (e.g. connector length override). */
  compilerConfig?: CompilerConfig
}

export interface RoutePlan {
  /** The compiled session: phases, work pattern, total distance. */
  plan: SessionPlan
  /** The work phase's terrain demands, threaded into the finder. */
  requirements: TerrainRequirements
  /** Ranked work segments matching those demands, best first. */
  segments: WorkSegment[]
}

/** The work phase always carries non-null requirements; guard defensively. */
function workPhase(plan: SessionPlan): PhasePlan & { requirements: TerrainRequirements } {
  const work = plan.phases.find((phase) => phase.kind === 'work')
  if (!work || work.requirements === null) {
    throw new Error('compiled plan has no work phase with requirements')
  }
  return { ...work, requirements: work.requirements }
}

export async function planRoute(
  session: Session,
  start: LatLon,
  deps: PlanRouteDeps,
  options: PlanRouteOptions = {},
): Promise<RoutePlan> {
  const { searchRadiusMeters = 1200, maxResults, compilerConfig } = options

  const plan = compileSession(session, compilerConfig)
  const work = workPhase(plan)

  const { ways, barrierNodeIds } = await deps.fetchWays(start, searchRadiusMeters)
  const graph = buildGraph(ways, barrierNodeIds)
  const segments = await findWorkSegments(graph, start, work.requirements, deps.sampleElevations, {
    maxDistanceFromStartMeters: searchRadiusMeters,
    maxResults,
    workTargetMeters: work.targetMeters,
  })

  return { plan, requirements: work.requirements, segments }
}
