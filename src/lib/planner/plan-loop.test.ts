import { describe, expect, it } from 'vitest'
import type { LatLon, OsmWay } from '@/lib/engine/types'
import { LoopUnreachableError, loopSearchRadiusMeters, planLoop } from './plan-loop'

/** A way from explicit [lat, lon] points with explicit node ids. */
function way(id: number, nodeIds: number[], pts: Array<[number, number]>): OsmWay {
  return {
    id,
    tags: { highway: 'residential', surface: 'asphalt' },
    nodeIds,
    points: pts.map(([lat, lon]) => ({ lat, lon })),
  }
}

// The loop.test.ts 3×3 grid: residential streets at ~500m spacing.
const LAT0 = 51.45
const LON0 = -2.58
function gridWays(): OsmWay[] {
  const ways: OsmWay[] = []
  const nodeId = (r: number, c: number): number => 100 + r * 10 + c
  const point = (r: number, c: number): [number, number] => [LAT0 + r * 0.0045, LON0 + c * 0.0072]
  let wayId = 1
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (c < 2)
        ways.push(way(wayId++, [nodeId(r, c), nodeId(r, c + 1)], [point(r, c), point(r, c + 1)]))
      if (r < 2)
        ways.push(way(wayId++, [nodeId(r, c), nodeId(r + 1, c)], [point(r, c), point(r + 1, c)]))
    }
  }
  return ways
}

const door: LatLon = { lat: 51.4501, lon: -2.5801 } // ~13m off the grid corner

function depsFor(ways: OsmWay[]) {
  const calls: Array<{ center: LatLon; radiusMeters: number }> = []
  return {
    calls,
    fetchWays: async (center: LatLon, radiusMeters: number) => {
      calls.push({ center, radiusMeters })
      return ways
    },
  }
}

describe('loopSearchRadiusMeters', () => {
  it('keeps the v1 default for short sessions and scales up for long ones', () => {
    expect(loopSearchRadiusMeters(3000)).toBe(1200)
    expect(loopSearchRadiusMeters(10000)).toBe(2000)
    expect(loopSearchRadiusMeters(30000)).toBe(3500) // clamped
  })
})

describe('planLoop', () => {
  it('returns a door-to-door loop of roughly the session distance', async () => {
    const deps = depsFor(gridWays())
    const result = await planLoop({ type: 'easy', distanceMeters: 2000 }, door, deps)
    expect(result.loop.lengthMeters).toBeGreaterThan(1600)
    expect(result.loop.lengthMeters).toBeLessThan(2400)
    expect(result.loop.points[0]).toEqual(result.loop.points[result.loop.points.length - 1])
    expect(result.targetMeters).toBe(2000)
  })

  it('fetches ways with the distance-scaled radius', async () => {
    // The 2km grid cannot host a 10km loop — the fetch still happens first,
    // with the radius scaled to the ask.
    const deps = depsFor(gridWays())
    await planLoop({ type: 'long', distanceMeters: 10000 }, door, deps).catch(() => undefined)
    expect(deps.calls).toHaveLength(1)
    expect(deps.calls[0].radiusMeters).toBe(2000)
  })

  it('throws LoopUnreachableError when the network cannot host the distance', async () => {
    const stub = [way(1, [10, 20], [[51.45, -2.58], [51.4505, -2.58]])] // ~56m
    await expect(
      planLoop({ type: 'easy', distanceMeters: 10000 }, door, depsFor(stub)),
    ).rejects.toBeInstanceOf(LoopUnreachableError)
  })
})
