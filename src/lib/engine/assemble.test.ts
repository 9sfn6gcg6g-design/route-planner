import { describe, expect, it } from 'vitest'
import { pathLengthMeters } from './geo'
import {
  assembleLoopRoute,
  assembleRoute,
  buildWorkGeometry,
  rotateRingToNearest,
} from './assemble'
import type { LatLon } from './types'

const stretch: LatLon[] = [
  { lat: 51.45, lon: -2.58 },
  { lat: 51.454, lon: -2.58 },
  { lat: 51.459, lon: -2.58 },
]
const stretchLength = pathLengthMeters(stretch) // ~1001m

const ring: LatLon[] = [
  { lat: 51.45, lon: -2.58 },
  { lat: 51.451, lon: -2.579 },
  { lat: 51.452, lon: -2.58 },
  { lat: 51.451, lon: -2.581 },
  { lat: 51.45, lon: -2.58 },
]

describe('buildWorkGeometry', () => {
  it('runs a stretch out-and-back for the required passes', () => {
    // target 6800m on ~1001m => 7 passes
    const work = buildWorkGeometry(
      { points: stretch, lengthMeters: stretchLength, isCycle: false },
      6800,
    )
    expect(work.passes).toBe(7)
    expect(work.meters).toBeCloseTo(stretchLength * 7, 6)
    // odd passes end at the far end
    expect(work.points[work.points.length - 1]).toEqual(stretch[2])
    expect(pathLengthMeters(work.points)).toBeCloseTo(stretchLength * 7, 0)
    // detect apex/seam duplication regressions: 7 passes of 3-point stretch with 2-point joins = 15 points
    expect(work.points.length).toBe(15)
  })

  it('even passes return to the near end', () => {
    const work = buildWorkGeometry(
      { points: stretch, lengthMeters: stretchLength, isCycle: false },
      2000,
    )
    expect(work.passes).toBe(2)
    expect(work.points[work.points.length - 1]).toEqual(stretch[0])
  })

  it('laps a cycle forward without reversing', () => {
    const ringLength = pathLengthMeters(ring)
    const work = buildWorkGeometry({ points: ring, lengthMeters: ringLength, isCycle: true }, ringLength * 3)
    expect(work.passes).toBe(3)
    expect(work.points[0]).toEqual(ring[0])
    expect(work.points[work.points.length - 1]).toEqual(ring[0])
    expect(pathLengthMeters(work.points)).toBeCloseTo(ringLength * 3, 0)
    // detect apex/seam duplication regressions: 3 laps of 5-point ring with 4-point joins = 13 points
    expect(work.points.length).toBe(13)
  })

  it('always makes at least one pass and rejects nonsense targets', () => {
    const work = buildWorkGeometry({ points: stretch, lengthMeters: stretchLength, isCycle: false }, 100)
    expect(work.passes).toBe(1)
    expect(() =>
      buildWorkGeometry({ points: stretch, lengthMeters: stretchLength, isCycle: false }, 0),
    ).toThrow(/target/i)
  })
})

describe('rotateRingToNearest', () => {
  it('starts the ring at the point nearest the target and preserves length', () => {
    const target: LatLon = { lat: 51.452, lon: -2.5801 }
    const rotated = rotateRingToNearest(ring, target)
    expect(rotated[0]).toEqual({ lat: 51.452, lon: -2.58 })
    expect(rotated[rotated.length - 1]).toEqual(rotated[0])
    expect(rotated).toHaveLength(ring.length)
    expect(pathLengthMeters(rotated)).toBeCloseTo(pathLengthMeters(ring), 6)
  })

  it('rejects an unclosed ring', () => {
    expect(() => rotateRingToNearest(stretch, { lat: 51.45, lon: -2.58 })).toThrow(/ring/i)
  })
})

describe('assembleRoute', () => {
  it('concatenates phases with contiguous spans and summed totals', () => {
    const warmup = { points: [{ lat: 51.44, lon: -2.58 }, stretch[0]], lengthMeters: 500 }
    const cooldown = { points: [stretch[2], { lat: 51.44, lon: -2.58 }], lengthMeters: 600 }
    const work = buildWorkGeometry(
      { points: stretch, lengthMeters: stretchLength, isCycle: false },
      1000,
    )
    const route = assembleRoute(warmup, work, cooldown)
    expect(route.phases.map((p) => p.kind)).toEqual(['warmup', 'work', 'cooldown'])
    expect(route.totalMeters).toBeCloseTo(500 + work.meters + 600, 6)
    expect(route.phases[0].startIndex).toBe(0)
    expect(route.phases[1].startIndex).toBe(route.phases[0].endIndex + 1)
    expect(route.phases[2].startIndex).toBe(route.phases[1].endIndex + 1)
    expect(route.phases[2].endIndex).toBe(route.points.length - 1)
    // verify total point count equals sum of input array lengths (detects missing push mutations)
    expect(route.points.length).toBe(warmup.points.length + work.points.length + cooldown.points.length)
    // verify content at phase boundaries
    expect(route.points[route.phases[0].startIndex]).toEqual(warmup.points[0])
    expect(route.points[route.phases[0].endIndex]).toEqual(warmup.points[warmup.points.length - 1])
    expect(route.points[route.phases[1].startIndex]).toEqual(work.points[0])
    expect(route.points[route.phases[1].endIndex]).toEqual(work.points[work.points.length - 1])
    expect(route.points[route.phases[2].startIndex]).toEqual(cooldown.points[0])
    expect(route.points[route.phases[2].endIndex]).toEqual(cooldown.points[cooldown.points.length - 1])
    // verify duplicated join points between phases: warmup end == work start, work end == cooldown start
    expect(route.points[route.phases[0].endIndex]).toEqual(route.points[route.phases[1].startIndex])
    expect(route.points[route.phases[1].endIndex]).toEqual(route.points[route.phases[2].startIndex])
  })
})

describe('assembleLoopRoute', () => {
  it('wraps a round-trip loop as a single work phase', () => {
    const loop = { points: ring, lengthMeters: 8000 }
    const route = assembleLoopRoute(loop)
    expect(route.phases).toEqual([
      { kind: 'work', startIndex: 0, endIndex: ring.length - 1, meters: 8000 },
    ])
    expect(route.totalMeters).toBe(8000)
  })
})
