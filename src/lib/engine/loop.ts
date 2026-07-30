import type { LatLon, RunEdge, RunGraph } from './types'
import { bearingDegrees } from './geo'
import { nodeCoordinates, reachableLengths, routeBetween } from './route'

/**
 * A door-to-door loop on the run graph (v1.1 slice D, decisions 5/6/17): out
 * along a quiet path to a turn point at ~half the session distance, back with
 * the outbound ground penalized so the return finds different streets where
 * the network allows. Where it doesn't (a dead-end road), the loop honestly
 * degrades to out-and-back.
 */
export interface LoopRoute {
  /** Closed path: first and last point are the door node. */
  points: LatLon[]
  lengthMeters: number
  /** Length-weighted mean quietness over every traversed edge (decision 17's ranking statistic). */
  meanQuietness: number
  /** Fraction of the return leg reusing outbound ground: 0 = true loop, 1 = out-and-back. */
  overlapFraction: number
}

export interface FindLoopOptions {
  /** Cap on turn-point candidates routed in full. Default 16. */
  maxCandidates?: number
  /** Cost multiplier applied to outbound edges when routing the return leg. Default 4. */
  penaltyFactor?: number
}

/** Turn points are considered at path lengths within this share of the target. */
const HALF_WINDOW = { min: 0.3, max: 0.6 }
/** Ideal outbound share — the return leg tends to run a little longer. */
const IDEAL_HALF = 0.45
/** Candidate diversity: best few per compass sector around the door. */
const BEARING_SECTORS = 8
const PER_SECTOR = 2

/**
 * Loop score: distance fit leads (the runner asked for this distance),
 * quietness and true-loopness follow. Weights sum to 1; tunable v1 constants.
 */
const SCORE_WEIGHTS = { fit: 0.5, quietness: 0.3, loopness: 0.2 }

const edgeLengthSum = (edges: RunEdge[]): number =>
  edges.reduce((sum, e) => sum + e.lengthMeters, 0)

function meanQuietnessOf(edges: RunEdge[]): number {
  const total = edgeLengthSum(edges)
  if (total === 0) return 0
  return edges.reduce((sum, e) => sum + e.quietness * e.lengthMeters, 0) / total
}

/** Find the best door-to-door loop of roughly `targetMeters` from `doorNodeId`. */
export function findLoop(
  graph: RunGraph,
  doorNodeId: number,
  targetMeters: number,
  options: FindLoopOptions = {},
): LoopRoute | null {
  const { maxCandidates = 16, penaltyFactor = 4 } = options
  const lengths = reachableLengths(graph, doorNodeId)
  const coordinates = nodeCoordinates(graph)
  const door = coordinates.get(doorNodeId)
  if (door === undefined || lengths.size === 0) return null

  const inWindow: Array<{ nodeId: number; lengthMeters: number }> = []
  for (const [nodeId, lengthMeters] of lengths) {
    if (
      lengthMeters >= HALF_WINDOW.min * targetMeters &&
      lengthMeters <= HALF_WINDOW.max * targetMeters
    ) {
      inWindow.push({ nodeId, lengthMeters })
    }
  }
  if (inWindow.length === 0) return null

  // Best-fitting first, then keep a few per compass sector so candidates
  // fan out around the door instead of clustering along one street.
  inWindow.sort(
    (a, b) =>
      Math.abs(a.lengthMeters - IDEAL_HALF * targetMeters) -
      Math.abs(b.lengthMeters - IDEAL_HALF * targetMeters),
  )
  const perSector = new Map<number, number>()
  const candidates: number[] = []
  for (const { nodeId } of inWindow) {
    if (candidates.length >= maxCandidates) break
    const point = coordinates.get(nodeId)
    if (point === undefined) continue
    const sector = Math.floor(((bearingDegrees(door, point) % 360) / 360) * BEARING_SECTORS)
    const used = perSector.get(sector) ?? 0
    if (used >= PER_SECTOR) continue
    perSector.set(sector, used + 1)
    candidates.push(nodeId)
  }

  let best: { loop: LoopRoute; score: number } | null = null
  for (const nodeId of candidates) {
    const out = routeBetween(graph, doorNodeId, nodeId)
    if (out === null) continue
    const outEdges = new Set(out.edges)
    const back = routeBetween(graph, nodeId, doorNodeId, {
      penalizedEdges: outEdges,
      penaltyFactor,
    })
    if (back === null) continue

    const lengthMeters = out.lengthMeters + back.lengthMeters
    const sharedMeters = edgeLengthSum(back.edges.filter((e) => outEdges.has(e)))
    const overlapFraction = back.lengthMeters > 0 ? sharedMeters / back.lengthMeters : 1
    const meanQuietness = meanQuietnessOf([...out.edges, ...back.edges])
    const fit = Math.max(0, 1 - Math.abs(lengthMeters - targetMeters) / targetMeters)
    const score =
      SCORE_WEIGHTS.fit * fit +
      SCORE_WEIGHTS.quietness * meanQuietness +
      SCORE_WEIGHTS.loopness * (1 - overlapFraction)
    if (best === null || score > best.score) {
      best = {
        score,
        loop: {
          points: [...out.points, ...back.points.slice(1)],
          lengthMeters,
          meanQuietness,
          overlapFraction,
        },
      }
    }
  }
  return best?.loop ?? null
}
