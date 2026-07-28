import type { Chain, RunEdge, RunGraph } from './types'

function addIncident(adjacency: Map<number, RunEdge[]>, nodeId: number, edge: RunEdge): void {
  const list = adjacency.get(nodeId)
  if (list) list.push(edge)
  else adjacency.set(nodeId, [edge])
}

/**
 * Merge edges through degree-2 splice nodes into maximal chains. A chain
 * ends only at a true crossing (degree >= 3), a dead end (degree 1), or by
 * closing back on its start (pure degree-2 cycles, e.g. a park loop).
 * Interior nodes are all degree-2 by construction, so a chain has no
 * crossings inside it — this is what makes chain length the honest
 * "uninterrupted stretch" measure the domain's minUninterruptedMeters
 * asks about.
 */
export function buildChains(graph: RunGraph): Chain[] {
  const adjacency = new Map<number, RunEdge[]>()
  for (const edge of graph.edges) {
    addIncident(adjacency, edge.fromNodeId, edge)
    if (edge.toNodeId !== edge.fromNodeId) addIncident(adjacency, edge.toNodeId, edge)
  }
  const degree = (nodeId: number): number => graph.nodeDegree.get(nodeId) ?? 0
  const visited = new Set<RunEdge>()
  const chains: Chain[] = []

  const walk = (startNodeId: number, firstEdge: RunEdge): Chain => {
    const edges: RunEdge[] = []
    const points: Chain['points'] = []
    let nodeId = startNodeId
    let edge: RunEdge | undefined = firstEdge
    while (edge && !visited.has(edge)) {
      visited.add(edge)
      edges.push(edge)
      const forward = edge.fromNodeId === nodeId
      const oriented = forward ? edge.points : [...edge.points].reverse()
      if (points.length === 0) points.push(...oriented)
      else points.push(...oriented.slice(1))
      nodeId = forward ? edge.toNodeId : edge.fromNodeId
      if (degree(nodeId) !== 2) break
      edge = (adjacency.get(nodeId) ?? []).find((e) => !visited.has(e))
    }
    return {
      edges,
      points,
      lengthMeters: edges.reduce((sum, e) => sum + e.lengthMeters, 0),
      startNodeId,
      endNodeId: nodeId,
      isCycle: nodeId === startNodeId && edges.length > 0,
    }
  }

  // Pass 1: start every chain from a terminal (dead end or true crossing).
  for (const edge of graph.edges) {
    if (visited.has(edge)) continue
    if (degree(edge.fromNodeId) !== 2) chains.push(walk(edge.fromNodeId, edge))
    else if (degree(edge.toNodeId) !== 2) chains.push(walk(edge.toNodeId, edge))
  }
  // Pass 2: whatever remains is a pure degree-2 cycle.
  for (const edge of graph.edges) {
    if (visited.has(edge)) continue
    chains.push(walk(edge.fromNodeId, edge))
  }
  return chains
}
