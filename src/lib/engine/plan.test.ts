import { describe, expect, it } from 'vitest'
import type { Session } from '@/lib/domain/types'
import type { FootRoute } from './connectors'
import type { ElevationSampler } from './finder'
import { generateRoute, type RoutePlanDeps } from './plan'
import type { LatLon, OsmWay } from './types'

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

interface Recorded {
  waysCalls: Array<{ center: LatLon; radius: number }>
  footCalls: Array<{ from: LatLon; to: LatLon }>
  roundTripCalls: Array<{ start: LatLon; length: number }>
}

function fakeDeps(ways: OsmWay[]): { deps: RoutePlanDeps; recorded: Recorded } {
  const recorded: Recorded = { waysCalls: [], footCalls: [], roundTripCalls: [] }
  const deps: RoutePlanDeps = {
    fetchWays: async (center, radiusMeters) => {
      recorded.waysCalls.push({ center, radius: radiusMeters })
      return ways
    },
    sampleElevations: flatSampler,
    fetchFootRoute: async (from, to) => {
      recorded.footCalls.push({ from, to })
      return { points: [from, to], lengthMeters: 500 } satisfies FootRoute
    },
    fetchRoundTrip: async (s, lengthMeters) => {
      recorded.roundTripCalls.push({ start: s, length: lengthMeters })
      return { points: [s, { lat: s.lat + 0.01, lon: s.lon }, s], lengthMeters } satisfies FootRoute
    },
  }
  return { deps, recorded }
}

const intervalsSession: Session = { type: 'intervals', reps: 6, repMeters: 800, recovery: 'jog' }

describe('generateRoute — stretch sessions', () => {
  it('generates warmup, laps, cooldown, and gpx for intervals', async () => {
    const { deps, recorded } = fakeDeps([
      // 12-node way from {51.46, -2.57} → {51.47, -2.57} (~1223m).
      // Work target: 6800m (6 reps × 800m + recoveries).
      // Passes: round(6800/1223) = 6 (even).
      // Even passes → exits at near point (same as entry), diverging from raw chain's far end.
      straightWay(1, 51.46, -2.57, 12, 'residential', 'asphalt'),
    ])
    const generated = await generateRoute(intervalsSession, start, deps)
    // fetch radius covers the prefilter radius plus the stretch requirement
    expect(recorded.waysCalls).toHaveLength(1)
    expect(recorded.waysCalls[0].center).toEqual(start)
    expect(recorded.waysCalls[0].radius).toBe(2000 + 1000)
    expect(generated.segment).not.toBeNull()
    expect(generated.route.phases.map((p) => p.kind)).toEqual(['warmup', 'work', 'cooldown'])
    // warmup goes from the runner's start to the work entry
    expect(recorded.footCalls).toHaveLength(2)
    expect(recorded.footCalls[0].from).toEqual(start)
    // work geometry entry: first point of way (moved away from start to catch entry=start mutant)
    const expectedEntry = { lat: 51.46, lon: -2.57 }
    expect(recorded.footCalls[0].to).toEqual(expectedEntry)
    // work geometry exit: for even passes (6), returns to entry point (near), not raw chain's far end
    expect(recorded.footCalls[1].from).toEqual(expectedEntry)
    // cooldown returns home
    expect(recorded.footCalls[1].to).toEqual(start)
    expect(generated.gpx).toContain('<name>Work start</name>')
    expect(generated.gpx).toContain('Intervals 6x800m')
    expect(generated.sessionPlan.workPattern).toBe('laps')
    expect(generated.route.totalMeters).toBeGreaterThan(6800)
  })

  it('throws a descriptive error when no segment qualifies', async () => {
    const { deps } = fakeDeps([straightWay(1, 51.45, -2.58, 10, 'trunk', 'asphalt')])
    await expect(generateRoute(intervalsSession, start, deps)).rejects.toThrow(/no suitable/i)
  })
})

describe('generateRoute — loop sessions', () => {
  it('routes easy runs through a round trip and skips the finder entirely', async () => {
    const { deps, recorded } = fakeDeps([])
    const generated = await generateRoute({ type: 'easy', distanceMeters: 8000 }, start, deps)
    expect(recorded.roundTripCalls).toEqual([{ start, length: 8000 }])
    expect(recorded.waysCalls).toHaveLength(0)
    expect(recorded.footCalls).toHaveLength(0)
    expect(generated.segment).toBeNull()
    expect(generated.route.phases).toHaveLength(1)
    expect(generated.gpx).not.toContain('<wpt')
    expect(generated.gpx).toContain('Easy run 8.0k')
  })
})
