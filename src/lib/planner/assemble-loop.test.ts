import { describe, expect, it } from 'vitest'
import { buildGraph } from '@/lib/engine/graph'
import { pathLengthMeters } from '@/lib/engine/geo'
import type { LatLon, OsmWay } from '@/lib/engine/types'
import { assembleDoorToDoorLoop } from './assemble-loop'

/** A straight way heading north; ~111m per 0.001 lat step. */
function straightWay(id: number, startLat: number, lon: number, nodeCount: number): OsmWay {
  return {
    id,
    tags: { highway: 'residential' },
    nodeIds: Array.from({ length: nodeCount }, (_, i) => id * 1000 + i),
    points: Array.from({ length: nodeCount }, (_, i) => ({ lat: startLat + i * 0.001, lon })),
  }
}

const start: LatLon = { lat: 51.45, lon: -2.58 }

describe('assembleDoorToDoorLoop (decision 21)', () => {
  it('builds a loop that starts and ends at the door, with warmup/work/cooldown', () => {
    const way = straightWay(1, 51.45, -2.58, 10) // ~1000m north from the door
    const graph = buildGraph([way])
    const stretchMeters = pathLengthMeters(way.points) // ~1000m
    // ~2800m of work over a ~1000m stretch = 3 passes (ends at the far end), so
    // the cooldown is a real leg back to the door, not a zero-length hop.
    const route = assembleDoorToDoorLoop(
      graph,
      start,
      { points: way.points, lengthMeters: stretchMeters, isCycle: false },
      2800,
    )
    expect(route).not.toBeNull()
    const pts = route!.points
    expect(pts[0].lat).toBeCloseTo(start.lat, 4)
    expect(pts[0].lon).toBeCloseTo(start.lon, 4)
    expect(pts[pts.length - 1].lat).toBeCloseTo(start.lat, 4)
    expect(pts[pts.length - 1].lon).toBeCloseTo(start.lon, 4)
    expect(route!.phases.map((p) => p.kind)).toEqual(['warmup', 'work', 'cooldown'])
    // three work passes (~3000m) plus a cooldown leg back to the door
    expect(route!.totalMeters).toBeGreaterThan(3 * stretchMeters)
  })

  it('returns null when a work stretch is on a disconnected part of the graph', () => {
    const near = straightWay(1, 51.45, -2.58, 6) // by the door
    const far = straightWay(2, 51.6, -2.4, 6) // a separate, unconnected road
    const graph = buildGraph([near, far])
    const route = assembleDoorToDoorLoop(
      graph,
      start,
      { points: far.points, lengthMeters: pathLengthMeters(far.points), isCycle: false },
      2000,
    )
    expect(route).toBeNull()
  })
})
