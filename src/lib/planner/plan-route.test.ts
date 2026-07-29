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
const intervals: Session = { type: 'intervals', reps: 6, repMeters: 800, recovery: 'static' }

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
    expect(deps.calls[0].radiusMeters).toBe(2000)

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
})
