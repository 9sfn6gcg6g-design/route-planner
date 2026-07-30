import type { LatLon, RunEdge, RunGraph } from './types'
import { haversineMeters } from './geo'

/**
 * Keyless connector routing on the RunGraph (decision 6, amended 2026-07-30):
 * shortest/quiet paths between graph nodes, computed client-side. Connectors
 * carry `requirements: null` — any runnable terrain — so routing weighs
 * quietness as a preference, never a gate.
 */
export interface GraphRoute {
  /** Ordered path from the start node to the end node, junction points deduplicated. */
  points: LatLon[]
  lengthMeters: number
  edges: RunEdge[]
}

export interface SnappedNode {
  nodeId: number
  point: LatLon
  distanceMeters: number
}

/**
 * How strongly quietness discounts an edge: traversal cost is
 * `lengthMeters * (1 + QUIET_COST_FACTOR * (1 - quietness))`, so a trunk road
 * (quietness 0.1) costs ~2.4× its length while a cycleway (0.9) costs ~1.2× —
 * a quiet detour wins unless it is much longer. Tunable v1 constant.
 */
const QUIET_COST_FACTOR = 1.5

const edgeCost = (edge: RunEdge): number =>
  edge.lengthMeters * (1 + QUIET_COST_FACTOR * (1 - edge.quietness))

interface AdjacencyEntry {
  edge: RunEdge
  /** True when traversal runs the edge from its `fromNodeId` to its `toNodeId`. */
  forward: boolean
  neighbor: number
}

function buildAdjacency(graph: RunGraph): Map<number, AdjacencyEntry[]> {
  const adjacency = new Map<number, AdjacencyEntry[]>()
  const add = (node: number, entry: AdjacencyEntry): void => {
    const list = adjacency.get(node)
    if (list) list.push(entry)
    else adjacency.set(node, [entry])
  }
  for (const edge of graph.edges) {
    add(edge.fromNodeId, { edge, forward: true, neighbor: edge.toNodeId })
    add(edge.toNodeId, { edge, forward: false, neighbor: edge.fromNodeId })
  }
  return adjacency
}

/** Minimal binary min-heap keyed on cost, for Dijkstra's frontier. */
class MinHeap {
  private items: Array<{ node: number; cost: number }> = []

  push(node: number, cost: number): void {
    this.items.push({ node, cost })
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.items[parent].cost <= this.items[i].cost) break
      ;[this.items[parent], this.items[i]] = [this.items[i], this.items[parent]]
      i = parent
    }
  }

  pop(): { node: number; cost: number } | undefined {
    const top = this.items[0]
    const last = this.items.pop()
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last
      let i = 0
      for (;;) {
        const left = 2 * i + 1
        const right = left + 1
        let smallest = i
        if (left < this.items.length && this.items[left].cost < this.items[smallest].cost)
          smallest = left
        if (right < this.items.length && this.items[right].cost < this.items[smallest].cost)
          smallest = right
        if (smallest === i) break
        ;[this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]]
        i = smallest
      }
    }
    return top
  }

  get size(): number {
    return this.items.length
  }
}

/** Every node's coordinate, taken from the edge endpoints that define it. */
function nodePoints(graph: RunGraph): Map<number, LatLon> {
  const points = new Map<number, LatLon>()
  for (const edge of graph.edges) {
    if (!points.has(edge.fromNodeId)) points.set(edge.fromNodeId, edge.points[0])
    if (!points.has(edge.toNodeId)) points.set(edge.toNodeId, edge.points[edge.points.length - 1])
  }
  return points
}

/** Snap an arbitrary point (the door, a stretch end) to the nearest graph node. */
export function snapToNode(graph: RunGraph, target: LatLon): SnappedNode | null {
  let best: SnappedNode | null = null
  for (const [nodeId, point] of nodePoints(graph)) {
    const distanceMeters = haversineMeters(target, point)
    if (best === null || distanceMeters < best.distanceMeters) {
      best = { nodeId, point, distanceMeters }
    }
  }
  return best
}

/**
 * Quietness-weighted shortest path between two graph nodes (Dijkstra).
 * Returns null when either node is unknown or no path exists. The reported
 * lengthMeters is the real ground distance — the quietness weighting shapes
 * the choice of path, not the measurement of it.
 */
export function routeBetween(
  graph: RunGraph,
  fromNodeId: number,
  toNodeId: number,
): GraphRoute | null {
  const points = nodePoints(graph)
  if (!points.has(fromNodeId) || !points.has(toNodeId)) return null
  const startPoint = points.get(fromNodeId)
  if (fromNodeId === toNodeId && startPoint !== undefined) {
    return { points: [startPoint], lengthMeters: 0, edges: [] }
  }

  const adjacency = buildAdjacency(graph)
  const costTo = new Map<number, number>([[fromNodeId, 0]])
  const arrivedBy = new Map<number, AdjacencyEntry & { prev: number }>()
  const settled = new Set<number>()
  const frontier = new MinHeap()
  frontier.push(fromNodeId, 0)

  while (frontier.size > 0) {
    const current = frontier.pop()
    if (current === undefined) break
    if (settled.has(current.node)) continue
    settled.add(current.node)
    if (current.node === toNodeId) break
    for (const entry of adjacency.get(current.node) ?? []) {
      if (settled.has(entry.neighbor)) continue
      const cost = current.cost + edgeCost(entry.edge)
      const known = costTo.get(entry.neighbor)
      if (known === undefined || cost < known) {
        costTo.set(entry.neighbor, cost)
        arrivedBy.set(entry.neighbor, { ...entry, prev: current.node })
        frontier.push(entry.neighbor, cost)
      }
    }
  }

  if (!settled.has(toNodeId)) return null

  const pathEdges: Array<AdjacencyEntry> = []
  for (let node = toNodeId; node !== fromNodeId; ) {
    const step = arrivedBy.get(node)
    if (step === undefined) return null
    pathEdges.push(step)
    node = step.prev
  }
  pathEdges.reverse()

  const routePoints: LatLon[] = []
  let lengthMeters = 0
  for (const step of pathEdges) {
    const oriented = step.forward ? step.edge.points : [...step.edge.points].reverse()
    routePoints.push(...(routePoints.length === 0 ? oriented : oriented.slice(1)))
    lengthMeters += step.edge.lengthMeters
  }
  return { points: routePoints, lengthMeters, edges: pathEdges.map((step) => step.edge) }
}
