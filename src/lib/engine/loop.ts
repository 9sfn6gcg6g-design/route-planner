import type { LatLon, RunEdge, RunGraph } from './types'
import { haversineMeters } from './geo'
import { nodeCoordinates, reachableLengths, routeBetween } from './route'

/**
 * A door-to-door loop on the run graph (v1.1 slice D, decisions 5/6/17),
 * assembled as a greedy waypoint tour: hop to successive turn points —
 * spread away from ground already visited, with used edges penalized so each
 * leg finds new streets — until the distance budget is nearly spent, then
 * route home. A tour reaches the asked distance even when the fetched map
 * disc is much smaller than the session (a 10 km loop hugs its
 * neighbourhood); where the network offers no alternatives (a dead-end
 * road), it honestly degrades toward out-and-back.
 */
export interface LoopRoute {
  /** Closed path: first and last point are the door node. */
  points: LatLon[]
  lengthMeters: number
  /** Length-weighted mean quietness over every traversed edge (decision 17's ranking statistic). */
  meanQuietness: number
  /** Fraction of the loop re-running ground it already covered: 0 = every street once, 1 = pure out-and-back. */
  overlapFraction: number
}

export interface FindLoopOptions {
  /** Hard cap on tour legs (excluding the leg home), guarding runaway walks. Default 10. */
  maxLegs?: number
  /** Cost multiplier for already-used edges when routing the next leg. Default 4. */
  penaltyFactor?: number
}

/** A leg aims for this share of the target, bounded by what the disc can reach. */
const LEG_SHARE = 3
const LEG_REACH_SHARE = 0.8
/** A leg accepts turn points within this window of its aimed length. */
const LEG_WINDOW = { min: 0.5, max: 1.15 }
/** Give up entirely when the farthest reachable node is this share of the target. */
const MIN_REACH_SHARE = 0.15
/** Going home reuses ground more readily than an outward leg. Kept below 2 so
 *  a direct reused path beats a fresh detour of twice its length outright —
 *  no cost ties on symmetric street grids. */
const HOMEWARD_PENALTY = 1.75
/** A leg may leave a return slightly over budget — mildly overshooting the
 *  target beats abandoning the tour at half the asked distance. */
const FEASIBLE_OVERSHOOT = 1.2

const edgeLengthSum = (edges: RunEdge[]): number =>
  edges.reduce((sum, e) => sum + e.lengthMeters, 0)

/** Find the best door-to-door loop of roughly `targetMeters` from `doorNodeId`. */
export function findLoop(
  graph: RunGraph,
  doorNodeId: number,
  targetMeters: number,
  options: FindLoopOptions = {},
): LoopRoute | null {
  const { maxLegs = 10, penaltyFactor = 4 } = options
  const coordinates = nodeCoordinates(graph)
  const door = coordinates.get(doorNodeId)
  if (door === undefined) return null
  const fromDoor = reachableLengths(graph, doorNodeId)
  if (fromDoor.size === 0) return null
  const maxReach = Math.max(...fromDoor.values())
  if (maxReach < MIN_REACH_SHARE * targetMeters) return null

  const legMeters = Math.min(targetMeters / LEG_SHARE, maxReach * LEG_REACH_SHARE)

  const points: LatLon[] = []
  const traversed: RunEdge[] = []
  const used = new Set<RunEdge>()
  const waypoints: LatLon[] = [door]
  let current = doorNodeId
  let totalMeters = 0

  const append = (legPoints: LatLon[], legEdges: RunEdge[], legMeters_: number): void => {
    points.push(...(points.length === 0 ? legPoints : legPoints.slice(1)))
    traversed.push(...legEdges)
    for (const edge of legEdges) used.add(edge)
    totalMeters += legMeters_
  }

  for (let leg = 0; leg < maxLegs; leg++) {
    const homeNow = fromDoor.get(current) ?? 0
    const remaining = targetMeters - totalMeters
    if (remaining <= homeNow + legMeters * 0.5) break

    const stepTarget = Math.min(legMeters, remaining * 0.6)
    const fromCurrent = current === doorNodeId ? fromDoor : reachableLengths(graph, current)
    let bestNode: number | null = null
    let bestScore = -Infinity
    for (const [nodeId, lengthMeters] of fromCurrent) {
      if (nodeId === current || nodeId === doorNodeId) continue
      if (lengthMeters < LEG_WINDOW.min * stepTarget) continue
      if (lengthMeters > LEG_WINDOW.max * stepTarget) continue
      // Feasibility: never stray beyond returnable ground (with mild slack).
      const homeAfter = fromDoor.get(nodeId)
      if (homeAfter === undefined || homeAfter > (remaining - lengthMeters) * FEASIBLE_OVERSHOOT)
        continue
      const point = coordinates.get(nodeId)
      if (point === undefined) continue
      // Spread: prefer turn points far from everywhere the tour has been,
      // lightly trading off leg-length fit. Deterministic tie-break.
      const spread = Math.min(...waypoints.map((w) => haversineMeters(w, point)))
      const score = spread - Math.abs(lengthMeters - stepTarget)
      if (score > bestScore || (score === bestScore && (bestNode === null || nodeId < bestNode))) {
        bestScore = score
        bestNode = nodeId
      }
    }
    if (bestNode === null) break

    const step = routeBetween(graph, current, bestNode, {
      penalizedEdges: used,
      penaltyFactor,
    })
    if (step === null) break
    append(step.points, step.edges, step.lengthMeters)
    const waypoint = coordinates.get(bestNode)
    if (waypoint !== undefined) waypoints.push(waypoint)
    current = bestNode
  }

  if (current === doorNodeId) return null
  const home = routeBetween(graph, current, doorNodeId, {
    penalizedEdges: used,
    penaltyFactor: HOMEWARD_PENALTY,
  })
  if (home === null) return null
  append(home.points, home.edges, home.lengthMeters)

  // Ground covered more than once, counted once per repeat traversal.
  const reusedMeters = edgeLengthSum(traversed) - edgeLengthSum([...new Set(traversed)])
  const meanQuietness =
    traversed.length > 0
      ? traversed.reduce((sum, e) => sum + e.quietness * e.lengthMeters, 0) /
        edgeLengthSum(traversed)
      : 0
  return {
    points,
    lengthMeters: totalMeters,
    meanQuietness,
    overlapFraction: totalMeters > 0 ? Math.min(1, reusedMeters / (totalMeters / 2)) : 1,
  }
}
