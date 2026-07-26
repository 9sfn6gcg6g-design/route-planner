import type { OsmWay, RunEdge, RunGraph } from './types'
import { pathLengthMeters } from './geo'
import { quietnessFor, surfaceKindFor } from './signals'

/**
 * A junction is any node used by more than one way (crossing or shared
 * endpoint). Each way is split at interior junction nodes so every edge
 * runs junction-to-junction (or way-end-to-way-end) with no crossings
 * inside it — which is exactly what "uninterrupted stretch" means to the
 * segment finder.
 */
export function buildGraph(ways: OsmWay[]): RunGraph {
  const usage = new Map<number, number>()
  for (const way of ways) {
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

  const edges: RunEdge[] = []
  for (const way of ways) {
    const quietness = quietnessFor(way.tags)
    const surface = surfaceKindFor(way.tags)
    const highway = way.tags.highway
    let sliceStart = 0
    for (let i = 1; i < way.nodeIds.length; i++) {
      const isLast = i === way.nodeIds.length - 1
      if (!isLast && !junctionNodeIds.has(way.nodeIds[i])) continue
      const points = way.points.slice(sliceStart, i + 1)
      edges.push({
        wayId: way.id,
        fromNodeId: way.nodeIds[sliceStart],
        toNodeId: way.nodeIds[i],
        points,
        lengthMeters: pathLengthMeters(points),
        highway,
        quietness,
        surface,
      })
      sliceStart = i
    }
  }

  return { edges, junctionNodeIds }
}
