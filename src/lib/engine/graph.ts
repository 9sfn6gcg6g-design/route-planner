import type { OsmWay, RunEdge, RunGraph } from './types'
import { pathLengthMeters } from './geo'
import { quietnessFor, surfaceKindFor } from './signals'

/**
 * A "junction node" here is any node used by more than one way (crossing or
 * shared endpoint), and every way is split at its interior junction nodes.
 * This is a conservative over-split, not a claim about real branching: OSM
 * commonly breaks a way into multiple ways at a node where only tag
 * metadata changes — a name, speed limit, or surface change — with no
 * actual fork in the road. So `junctionNodeIds` mixes true crossings with
 * these metadata splices, and no edge boundary should be read as "a road
 * meets another road here" on its own.
 *
 * `nodeDegree` disambiguates the two: it counts, per node, how many emitted
 * edges touch it (each edge contributes +1 to both its endpoints). A true
 * crossing has edge-degree >= 3 (at least three road-ends meet); a splice
 * has edge-degree exactly 2 (one edge ends, the next begins, same
 * direction of travel). Code that measures an "uninterrupted stretch" must
 * walk through degree-2 nodes and keep accumulating length — only a
 * degree >= 3 node is a real interruption — and junction-density metrics
 * (e.g. junctions per km) must count only degree >= 3 nodes, not every
 * member of `junctionNodeIds`.
 */
export function buildGraph(ways: OsmWay[], barrierNodeIds: Set<number> = new Set()): RunGraph {
  const runnableWays = ways.filter((way) => Boolean(way.tags.highway))

  const usage = new Map<number, number>()
  for (const way of runnableWays) {
    const seen = new Set<number>()
    for (const nodeId of way.nodeIds) {
      if (seen.has(nodeId)) continue // self-revisits don't make a junction
      seen.add(nodeId)
      usage.set(nodeId, (usage.get(nodeId) ?? 0) + 1)
    }
  }
  const junctionNodeIds = new Set<number>()
  for (const [nodeId, count] of usage) {
    if (count > 1) junctionNodeIds.add(nodeId)
  }

  // A blocking barrier (decision 20) is a dead stop: split the way there and
  // give each side of the gate its own synthetic node id, so the two edges no
  // longer share a node and nothing routes *through* the barrier — while the
  // ground on either side stays reachable. Synthetic ids are negative so they
  // can never collide with a real OSM node id.
  let nextSynthetic = -1
  const identify = (nodeId: number): number =>
    barrierNodeIds.has(nodeId) ? nextSynthetic-- : nodeId
  const isBoundary = (nodeId: number): boolean =>
    junctionNodeIds.has(nodeId) || barrierNodeIds.has(nodeId)

  const edges: RunEdge[] = []
  for (const way of runnableWays) {
    const quietness = quietnessFor(way.tags)
    const surface = surfaceKindFor(way.tags)
    const highway = way.tags.highway
    let sliceStart = 0
    for (let i = 1; i < way.nodeIds.length; i++) {
      const isLast = i === way.nodeIds.length - 1
      if (!isLast && !isBoundary(way.nodeIds[i])) continue
      const points = way.points.slice(sliceStart, i + 1)
      edges.push({
        wayId: way.id,
        fromNodeId: identify(way.nodeIds[sliceStart]),
        toNodeId: identify(way.nodeIds[i]),
        points,
        lengthMeters: pathLengthMeters(points),
        highway,
        quietness,
        surface,
      })
      sliceStart = i
    }
  }

  const nodeDegree = new Map<number, number>()
  for (const edge of edges) {
    nodeDegree.set(edge.fromNodeId, (nodeDegree.get(edge.fromNodeId) ?? 0) + 1)
    nodeDegree.set(edge.toNodeId, (nodeDegree.get(edge.toNodeId) ?? 0) + 1)
  }

  return { edges, junctionNodeIds, nodeDegree }
}
