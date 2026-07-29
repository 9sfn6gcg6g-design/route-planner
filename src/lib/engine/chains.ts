import { angularDifferenceDegrees, bearingDegrees } from './geo'
import type { Chain, RunEdge, RunGraph } from './types'

/** Highway classes whose joining at a node does not force a runner to stop. */
export const MINOR_JOIN_HIGHWAYS = new Set([
  'footway',
  'path',
  'cycleway',
  'track',
  'service',
  'pedestrian',
])

function addIncident(adjacency: Map<number, RunEdge[]>, nodeId: number, edge: RunEdge): void {
  const list = adjacency.get(nodeId)
  if (list) list.push(edge)
  else adjacency.set(nodeId, [edge])
}

/** A fork's straightest branch must stay within this of the arrival heading. */
const MAX_FORK_DEVIATION_DEGREES = 45
/** ...and beat the runner-up by at least this margin, else the fork is ambiguous. */
const FORK_MARGIN_DEGREES = 10

/** Bearing of the final approach into nodeId along an edge. */
function headingInto(edge: RunEdge, nodeId: number): number {
  const pts = edge.toNodeId === nodeId ? edge.points : [...edge.points].reverse()
  return bearingDegrees(pts[pts.length - 2], pts[pts.length - 1])
}

/** Bearing leaving nodeId along an edge. */
function headingOutOf(edge: RunEdge, nodeId: number): number {
  const pts = edge.fromNodeId === nodeId ? edge.points : [...edge.points].reverse()
  return bearingDegrees(pts[0], pts[1])
}

/** The uniquely straightest continuation among same-class fork branches, or null. */
function straightestBranch(byClass: RunEdge[], nodeId: number, arrived: RunEdge): RunEdge | null {
  const arrival = headingInto(arrived, nodeId)
  const scored = byClass
    .map((edge) => ({ edge, deviation: angularDifferenceDegrees(arrival, headingOutOf(edge, nodeId)) }))
    .sort((a, b) => a.deviation - b.deviation)
  const best = scored[0]
  if (best.deviation > MAX_FORK_DEVIATION_DEGREES) return null
  if (scored.length > 1 && scored[1].deviation - best.deviation < FORK_MARGIN_DEGREES) return null
  return best.edge
}

/**
 * Merge edges through degree-2 splice nodes into maximal chains, and —
 * per the minor-join rule — through degree->=3 nodes where the way (or its
 * highway class) continues and every other joining edge is minor. Such
 * nodes are recorded as tolerated junctions and count toward junction
 * density in evaluation. A true major crossing terminates the chain both
 * for the through-street and for a minor way crossing a major road:
 * crossing a road is a forced stop.
 */
export function buildChains(graph: RunGraph): Chain[] {
  const adjacency = new Map<number, RunEdge[]>()
  for (const edge of graph.edges) {
    addIncident(adjacency, edge.fromNodeId, edge)
    if (edge.toNodeId !== edge.fromNodeId) addIncident(adjacency, edge.toNodeId, edge)
  }
  // nodeDegree counts a self-loop edge TWICE (once per endpoint, both the
  // same node) while adjacency stores that edge only ONCE for that node
  // (addIncident guards fromNodeId === toNodeId). This mismatch is only
  // ever surfaced through `degree` and `adjacency` together, and all
  // passability logic below (structuralContinuation, the degree-2 splice
  // check in `walk`) must keep using them exactly as defined here, not
  // re-derive an "equivalent" count from the other.
  const degree = (nodeId: number): number => graph.nodeDegree.get(nodeId) ?? 0
  const visited = new Set<RunEdge>()
  const chains: Chain[] = []

  /**
   * At a degree->=3 node, pick the continuation: the unique candidate on
   * the same way, else the unique candidate of the same highway class.
   * Continue only if every OTHER candidate is a minor join; otherwise
   * terminate (return null). Passability is pure topology — this never
   * consults `visited`, so it gives the same answer regardless of which
   * direction a walk arrives from or what's already been walked. Callers
   * that care about traversal state (e.g. `walk`, which must not step onto
   * an edge another walk already consumed) check `visited` themselves on
   * the returned edge.
   */
  const structuralContinuation = (nodeId: number, arrived: RunEdge): RunEdge | null => {
    const candidates = (adjacency.get(nodeId) ?? []).filter((e) => e !== arrived)
    let chosen: RunEdge | null = null
    const byWay = candidates.filter((e) => e.wayId === arrived.wayId)
    if (byWay.length === 1) {
      chosen = byWay[0]
    } else if (byWay.length === 0) {
      const byClass = candidates.filter((e) => e.highway === arrived.highway)
      if (byClass.length === 1) chosen = byClass[0]
      else if (byClass.length > 1) chosen = straightestBranch(byClass, nodeId, arrived)
    }
    if (!chosen) return null
    const others = candidates.filter((e) => e !== chosen)
    if (!others.every((e) => MINOR_JOIN_HIGHWAYS.has(e.highway))) return null
    return chosen
  }

  /**
   * A chain passes through a node only when the continuation is mutual:
   * arriving on A picks B, and arriving on B picks A. Bearing selection is
   * direction-dependent (a Y-branch can see the stem as straight while the
   * stem sees ambiguity), so one-sided agreement would reintroduce
   * walk-order dependence.
   */
  const mutualContinuation = (nodeId: number, arrived: RunEdge): RunEdge | null => {
    const chosen = structuralContinuation(nodeId, arrived)
    if (!chosen) return null
    return structuralContinuation(nodeId, chosen) === arrived ? chosen : null
  }

  const walk = (startNodeId: number, firstEdge: RunEdge): Chain => {
    const edges: RunEdge[] = []
    const points: Chain['points'] = []
    const toleratedJunctionNodeIds: number[] = []
    let nodeId = startNodeId
    let edge: RunEdge | undefined | null = firstEdge
    while (edge && !visited.has(edge)) {
      visited.add(edge)
      edges.push(edge)
      const forward = edge.fromNodeId === nodeId
      const oriented = forward ? edge.points : [...edge.points].reverse()
      if (points.length === 0) points.push(...oriented)
      else points.push(...oriented.slice(1))
      nodeId = forward ? edge.toNodeId : edge.fromNodeId
      if (nodeId === startNodeId) break // closed back on the start: cycle complete
      if (degree(nodeId) === 2) {
        edge = (adjacency.get(nodeId) ?? []).find((e) => !visited.has(e))
      } else {
        const next = mutualContinuation(nodeId, edge)
        if (next && !visited.has(next)) {
          toleratedJunctionNodeIds.push(nodeId)
          edge = next
        } else {
          break
        }
      }
    }
    return {
      edges,
      points,
      lengthMeters: edges.reduce((sum, e) => sum + e.lengthMeters, 0),
      startNodeId,
      endNodeId: nodeId,
      isCycle: nodeId === startNodeId && edges.length > 0,
      toleratedJunctionNodeIds,
    }
  }

  // Pass 1: start every chain from a node the walk cannot pass through. A
  // node is a genuine start for this edge iff it's not a degree-2 splice
  // AND a walk arriving here via this edge could not structurally continue
  // (topology alone, independent of traversal order/visited state) — that
  // makes chain starts deterministic regardless of input way order.
  for (const edge of graph.edges) {
    if (visited.has(edge)) continue
    if (degree(edge.fromNodeId) !== 2 && mutualContinuation(edge.fromNodeId, edge) === null) {
      chains.push(walk(edge.fromNodeId, edge))
    } else if (
      degree(edge.toNodeId) !== 2 &&
      mutualContinuation(edge.toNodeId, edge) === null
    ) {
      chains.push(walk(edge.toNodeId, edge))
    }
  }
  // Pass 2: whatever remains is a pure degree-2 cycle.
  for (const edge of graph.edges) {
    if (visited.has(edge)) continue
    chains.push(walk(edge.fromNodeId, edge))
  }
  return chains
}
