import { describe, expect, it } from 'vitest'
import type { Session } from '@/lib/domain/types'
import { terrainRequirementsFor } from '@/lib/domain/profiles'
import type { ElevationSampler } from '@/lib/engine/finder'
import type { LatLon, OsmWay } from '@/lib/engine/types'
import { planRoute, type PlanRouteDeps } from './plan-route'

/** A straight way heading north; step 0.001 lat ≈ 111m per hop. */
function straightWay(
  id: number,
  startLat: number,
  lon: number,
  nodeCount: number,
  highway: string,
  surface?: string,
): OsmWay {
  const tags: Record<string, string> = { highway }
  if (surface) tags.surface = surface
  return {
    id,
    tags,
    nodeIds: Array.from({ length: nodeCount }, (_, i) => id * 1000 + i),
    points: Array.from({ length: nodeCount }, (_, i) => ({ lat: startLat + i * 0.001, lon })),
  }
}

/** A way from explicit [lat, lon] points, so junction bearings are controlled. */
function pointWay(id: number, nodeIds: number[], pts: Array<[number, number]>): OsmWay {
  return {
    id,
    tags: { highway: 'residential', surface: 'asphalt' },
    nodeIds,
    points: pts.map(([lat, lon]) => ({ lat, lon })),
  }
}

const start: LatLon = { lat: 51.45, lon: -2.58 }
const flatSampler: ElevationSampler = async (points) => points.map(() => 10)

interface RecordingDeps extends PlanRouteDeps {
  calls: Array<{ center: LatLon; radiusMeters: number }>
}

function depsFor(ways: OsmWay[], sampler: ElevationSampler = flatSampler): RecordingDeps {
  const calls: RecordingDeps['calls'] = []
  return {
    calls,
    fetchWays: async (center, radiusMeters) => {
      calls.push({ center, radiusMeters })
      return ways
    },
    sampleElevations: sampler,
  }
}

const easy: Session = { type: 'easy', distanceMeters: 3000 }
const intervals: Session = {
  type: 'intervals',
  reps: 6,
  repMeters: 800,
  recovery: 'static',
  targetPaceSecondsPerKm: 300,
}

describe('planRoute', () => {
  it('returns the compiled plan, its work requirements, and ranked segments', async () => {
    const deps = depsFor([straightWay(1, 51.45, -2.58, 10, 'residential', 'asphalt')])
    const result = await planRoute(easy, start, deps)

    expect(result.plan.session).toBe(easy)
    expect(result.plan.phases.some((p) => p.kind === 'work')).toBe(true)
    expect(result.requirements).toEqual(terrainRequirementsFor(easy))
    expect(result.segments.length).toBeGreaterThan(0)
  })

  it('threads the work-phase requirements: intervals rejects a short stretch easy accepts', async () => {
    // ~444m residential: fine for easy (no minimum stretch), too short for a
    // 800m interval rep.
    const ways = [straightWay(1, 51.45, -2.58, 5, 'residential', 'asphalt')]

    const easyResult = await planRoute(easy, start, depsFor(ways))
    expect(easyResult.segments).toHaveLength(1)

    const intervalsResult = await planRoute(intervals, start, depsFor(ways))
    expect(intervalsResult.requirements.minUninterruptedMeters).toBe(800)
    expect(intervalsResult.segments).toHaveLength(0)
  })

  it('fetches OSM ways around the start using the search radius', async () => {
    const deps = depsFor([straightWay(1, 51.45, -2.58, 10, 'residential', 'asphalt')])
    await planRoute(easy, start, deps)
    expect(deps.calls).toHaveLength(1)
    expect(deps.calls[0].center).toEqual(start)
    expect(deps.calls[0].radiusMeters).toBe(1200)

    const custom = depsFor([straightWay(1, 51.45, -2.58, 10, 'residential', 'asphalt')])
    await planRoute(easy, start, custom, { searchRadiusMeters: 500 })
    expect(custom.calls[0].radiusMeters).toBe(500)
  })

  it('excludes segments beyond the search radius', async () => {
    // ~111km north of the start; outside the 2000m prefilter.
    const deps = depsFor([straightWay(1, 52.45, -2.58, 10, 'residential', 'asphalt')])
    const result = await planRoute(easy, start, deps, { searchRadiusMeters: 2000 })
    expect(result.segments).toHaveLength(0)
  })

  it('caps results at maxResults', async () => {
    const ways = Array.from({ length: 4 }, (_, i) =>
      straightWay(i + 1, 51.45, -2.58 - i * 0.003, 10, 'residential', 'asphalt'),
    )
    const result = await planRoute(easy, start, depsFor(ways), { maxResults: 2 })
    expect(result.segments).toHaveLength(2)
  })

  it('threads the work-phase distance into conversational assembly (decision 17)', async () => {
    // A→Jn ~556m ends at a degree-3 junction with left/right branches ~485m,
    // so corridors terminate at Jn and only decision-15 assembly goes further.
    const A: [number, number] = [51.45, -2.58]
    const Jn: [number, number] = [51.455, -2.58]
    const W: [number, number] = [51.455, -2.587]
    const E: [number, number] = [51.455, -2.573]
    const ways = [
      pointWay(11, [10, 20], [A, Jn]),
      pointWay(12, [20, 30], [Jn, W]),
      pointWay(13, [20, 40], [Jn, E]),
    ]
    // 450m easy: every corridor already exceeds the target — no extension.
    const short = await planRoute({ type: 'easy', distanceMeters: 450 }, start, depsFor(ways))
    expect(Math.max(...short.segments.map((s) => s.lengthMeters))).toBeLessThan(700)
    // 10km easy: assembly extends across the junction toward the distance.
    const long = await planRoute({ type: 'easy', distanceMeters: 10000 }, start, depsFor(ways))
    expect(Math.max(...long.segments.map((s) => s.lengthMeters))).toBeGreaterThan(700)
  })
})
