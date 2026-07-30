import { describe, expect, it } from 'vitest'
import { buildGraph } from './graph'
import { routeBetween, snapToNode } from './route'
import type { LatLon, OsmWay } from './types'

/** A way from explicit [lat, lon] points with explicit node ids. */
function way(
  id: number,
  nodeIds: number[],
  pts: Array<[number, number]>,
  highway = 'residential',
): OsmWay {
  return { id, tags: { highway }, nodeIds, points: pts.map(([lat, lon]) => ({ lat, lon })) }
}

// Two junction nodes ~555m apart, connected two ways: a direct trunk road and
// a cycleway detour via D (~1050m total). D is interior to the cycleway (one
// edge), so the graph holds two parallel edges between nodes 10 and 20.
const A: [number, number] = [51.45, -2.58]
const B: [number, number] = [51.45, -2.572]
const D: [number, number] = [51.454, -2.576]

const parallel = [way(1, [10, 20], [A, B], 'trunk'), way(2, [10, 25, 20], [A, D, B], 'cycleway')]

// A simple three-node chain for multi-hop routing: A→B→C along two ways.
const C: [number, number] = [51.45, -2.564]
const chain = [way(1, [10, 20], [A, B]), way(2, [20, 30], [B, C])]

describe('routeBetween', () => {
  it('routes across multiple edges, joining points without duplicates', () => {
    const route = routeBetween(buildGraph(chain), 10, 30)
    expect(route).not.toBeNull()
    expect(route!.points[0]).toEqual({ lat: A[0], lon: A[1] })
    expect(route!.points[route!.points.length - 1]).toEqual({ lat: C[0], lon: C[1] })
    // A, B, C exactly once each — no doubled junction point.
    expect(route!.points).toHaveLength(3)
    expect(route!.lengthMeters).toBeGreaterThan(1000)
    expect(route!.edges).toHaveLength(2)
  })

  it('prefers a quiet detour over a shorter loud road', () => {
    const route = routeBetween(buildGraph(parallel), 10, 20)
    expect(route).not.toBeNull()
    // The cycleway detour passes through D; the trunk road does not.
    expect(route!.points.some((p) => p.lat === D[0] && p.lon === D[1])).toBe(true)
    expect(route!.lengthMeters).toBeGreaterThan(1000)
  })

  it('traverses edges in reverse when routing against way direction', () => {
    const route = routeBetween(buildGraph(chain), 30, 10)
    expect(route).not.toBeNull()
    expect(route!.points[0]).toEqual({ lat: C[0], lon: C[1] })
    expect(route!.points[route!.points.length - 1]).toEqual({ lat: A[0], lon: A[1] })
  })

  it('returns a zero-length route from a node to itself', () => {
    const route = routeBetween(buildGraph(chain), 20, 20)
    expect(route).not.toBeNull()
    expect(route!.lengthMeters).toBe(0)
    expect(route!.edges).toHaveLength(0)
    expect(route!.points).toHaveLength(1)
  })

  it('returns null when the destination is unreachable', () => {
    const disconnected = [...chain, way(3, [40, 50], [[51.5, -2.5], [51.5, -2.49]])]
    expect(routeBetween(buildGraph(disconnected), 10, 50)).toBeNull()
  })

  it('returns null for unknown node ids', () => {
    expect(routeBetween(buildGraph(chain), 10, 999)).toBeNull()
  })
})

describe('snapToNode', () => {
  it('snaps a nearby point to the nearest graph node', () => {
    const door: LatLon = { lat: 51.4501, lon: -2.5801 } // ~13m from A
    const snapped = snapToNode(buildGraph(chain), door)
    expect(snapped).not.toBeNull()
    expect(snapped!.nodeId).toBe(10)
    expect(snapped!.point).toEqual({ lat: A[0], lon: A[1] })
    expect(snapped!.distanceMeters).toBeLessThan(30)
  })

  it('returns null on an empty graph', () => {
    expect(snapToNode(buildGraph([]), { lat: 51.45, lon: -2.58 })).toBeNull()
  })
})
