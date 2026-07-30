import { describe, expect, it } from 'vitest'
import { buildGraph } from './graph'
import { findLoop } from './loop'
import type { OsmWay } from './types'

/** A way from explicit [lat, lon] points with explicit node ids. */
function way(
  id: number,
  nodeIds: number[],
  pts: Array<[number, number]>,
  highway = 'residential',
): OsmWay {
  return { id, tags: { highway }, nodeIds, points: pts.map(([lat, lon]) => ({ lat, lon })) }
}

// ~0.0045 lat ≈ 500m; ~0.0072 lon ≈ 500m at this latitude. A 3×3 grid of
// residential streets, 500m spacing — plenty of alternative paths, so a
// ~2km loop can go out one way and back another.
const LAT0 = 51.45
const LON0 = -2.58
const LAT_STEP = 0.0045
const LON_STEP = 0.0072

function gridWays(): OsmWay[] {
  const ways: OsmWay[] = []
  const nodeId = (r: number, c: number): number => 100 + r * 10 + c
  const point = (r: number, c: number): [number, number] => [
    LAT0 + r * LAT_STEP,
    LON0 + c * LON_STEP,
  ]
  let wayId = 1
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (c < 2) ways.push(way(wayId++, [nodeId(r, c), nodeId(r, c + 1)], [point(r, c), point(r, c + 1)]))
      if (r < 2) ways.push(way(wayId++, [nodeId(r, c), nodeId(r + 1, c)], [point(r, c), point(r + 1, c)]))
    }
  }
  return ways
}

// A dead-end road heading north as four ~500m ways sharing nodes (so the
// graph has turn-point nodes along it). The only "loop" is out-and-back.
const line = [
  way(1, [10, 20], [[51.45, -2.58], [51.4545, -2.58]]),
  way(2, [20, 30], [[51.4545, -2.58], [51.459, -2.58]]),
  way(3, [30, 40], [[51.459, -2.58], [51.4635, -2.58]]),
  way(4, [40, 50], [[51.4635, -2.58], [51.468, -2.58]]),
]

describe('findLoop', () => {
  it('returns a closed loop of roughly the target distance', () => {
    const loop = findLoop(buildGraph(gridWays()), 100, 2000)
    expect(loop).not.toBeNull()
    expect(loop!.points[0]).toEqual(loop!.points[loop!.points.length - 1])
    expect(loop!.lengthMeters).toBeGreaterThan(1600)
    expect(loop!.lengthMeters).toBeLessThan(2400)
  })

  it('comes back a different way when the network allows', () => {
    const loop = findLoop(buildGraph(gridWays()), 100, 2000)
    expect(loop!.overlapFraction).toBeLessThan(0.5)
  })

  it('degrades to out-and-back on a single dead-end road', () => {
    const loop = findLoop(buildGraph(line), 10, 2000)
    expect(loop).not.toBeNull()
    expect(loop!.points[0]).toEqual(loop!.points[loop!.points.length - 1])
    expect(loop!.lengthMeters).toBeGreaterThan(1600)
    expect(loop!.lengthMeters).toBeLessThan(2400)
    expect(loop!.overlapFraction).toBe(1)
  })

  it('reports length-weighted mean quietness over the loop', () => {
    const loop = findLoop(buildGraph(gridWays()), 100, 2000)
    expect(loop!.meanQuietness).toBeCloseTo(0.7, 5) // all residential
  })

  it('returns null when the graph cannot reach half the target', () => {
    const short = [way(1, [10, 20], [[51.45, -2.58], [51.4505, -2.58]])] // ~56m stub
    expect(findLoop(buildGraph(short), 10, 10000)).toBeNull()
  })

  it('returns null for an unknown start node', () => {
    expect(findLoop(buildGraph(gridWays()), 999, 2000)).toBeNull()
  })
})
