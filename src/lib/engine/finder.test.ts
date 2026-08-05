import { describe, expect, it } from 'vitest'
import type { QualityWeights, TerrainRequirements } from '@/lib/domain/types'
import { buildGraph } from './graph'
import { findWorkSegments, type ElevationSampler } from './finder'
import type { LatLon, OsmWay } from './types'

const structuredWeights: QualityWeights = {
  quietness: 0.3,
  gradient: 0.18,
  crossingFree: 0.27,
  turnSmoothness: 0.15,
  turnDensity: 0.1,
  nonRepetition: 0,
  lengthFit: 0,
}

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
    points: Array.from({ length: nodeCount }, (_, i) => ({
      lat: startLat + i * 0.001,
      lon,
    })),
  }
}

const start: LatLon = { lat: 51.45, lon: -2.58 }

const intervals: TerrainRequirements = {
  maxAvgGradientPercent: 1,
  minAvgGradientPercent: null,
  maxJunctionsPerKm: 6,
  minQuietness: 0.7,
  surface: 'paved',
  minUninterruptedMeters: 800,
  qualityWeights: structuredWeights,
  gradientShape: 'even',
}

const hills: TerrainRequirements = {
  maxAvgGradientPercent: 15,
  minAvgGradientPercent: 4,
  maxJunctionsPerKm: 6,
  minQuietness: 0.5,
  surface: 'any',
  minUninterruptedMeters: 300,
  qualityWeights: { quietness: 0.25, gradient: 0.35, crossingFree: 0.2, turnSmoothness: 0.12, turnDensity: 0.08, nonRepetition: 0, lengthFit: 0 },
  gradientShape: 'sustained',
}

const flatSampler: ElevationSampler = async (points) => points.map(() => 10)
/** Rises 4m per resampled point; at 40m spacing that is a ~10% gradient. */
const steepSampler: ElevationSampler = async (points) => points.map((_, i) => i * 4)

describe('findWorkSegments', () => {
  it('finds a quiet kilometre of residential street for intervals', async () => {
    const graph = buildGraph([
      straightWay(1, 51.45, -2.58, 10, 'residential', 'asphalt'), // ~1000m, quiet, paved
      straightWay(2, 51.45, -2.577, 10, 'trunk', 'asphalt'), // ~1000m but loud
    ])
    const results = await findWorkSegments(graph, start, intervals, flatSampler)
    expect(results).toHaveLength(1)
    expect(results[0].lengthMeters).toBeGreaterThan(800)
    expect(results[0].minQuietness).toBe(0.7)
    expect(results[0].avgAbsGradientPercent).toBe(0)
  })

  it('does not spend elevation calls on chains that fail static checks', async () => {
    const calls: LatLon[][] = []
    const recording: ElevationSampler = async (points) => {
      calls.push(points)
      return points.map(() => 10)
    }
    const graph = buildGraph([
      straightWay(1, 51.45, -2.58, 10, 'residential', 'asphalt'), // qualifies
      straightWay(2, 51.45, -2.577, 3, 'residential', 'asphalt'), // ~222m: too short
      straightWay(3, 51.45, -2.575, 10, 'trunk', 'asphalt'), // too loud
    ])
    await findWorkSegments(graph, start, intervals, recording)
    expect(calls).toHaveLength(1)
  })

  it('excludes chains beyond maxDistanceFromStartMeters without sampling them', async () => {
    const calls: LatLon[][] = []
    const recording: ElevationSampler = async (points) => {
      calls.push(points)
      return points.map(() => 10)
    }
    const graph = buildGraph([straightWay(1, 52.45, -2.58, 10, 'residential', 'asphalt')]) // ~111km away
    const results = await findWorkSegments(graph, start, intervals, recording, {
      maxDistanceFromStartMeters: 2000,
    })
    expect(results).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it('rejects flat ground for hills and accepts a climb', async () => {
    const graph = buildGraph([straightWay(1, 51.45, -2.58, 5, 'path')]) // ~444m, unpaved ok for hills
    const flat = await findWorkSegments(graph, start, hills, flatSampler)
    expect(flat).toHaveLength(0)
    const steep = await findWorkSegments(graph, start, hills, steepSampler)
    expect(steep).toHaveLength(1)
    expect(steep[0].avgAbsGradientPercent).toBeGreaterThan(4)
  })

  it('ranks quieter stretches first', async () => {
    const graph = buildGraph([
      straightWay(1, 51.45, -2.58, 10, 'residential', 'asphalt'), // 0.7
      straightWay(2, 51.45, -2.577, 10, 'cycleway', 'asphalt'), // 0.9
    ])
    const results = await findWorkSegments(graph, start, intervals, flatSampler)
    expect(results).toHaveLength(2)
    expect(results[0].minQuietness).toBe(0.9)
    expect(results[1].minQuietness).toBe(0.7)
  })

  it('caps results at maxResults', async () => {
    const ways = Array.from({ length: 4 }, (_, i) =>
      straightWay(i + 1, 51.45, -2.58 - i * 0.003, 10, 'residential', 'asphalt'),
    )
    const results = await findWorkSegments(buildGraph(ways), start, intervals, flatSampler, {
      maxResults: 2,
    })
    expect(results).toHaveLength(2)
  })

  it('batches all candidates into a single sampler call', async () => {
    const calls: LatLon[][] = []
    const recording: ElevationSampler = async (points) => {
      calls.push(points)
      return points.map(() => 10)
    }
    const graph = buildGraph([
      straightWay(1, 51.45, -2.58, 10, 'residential', 'asphalt'),
      straightWay(2, 51.45, -2.577, 10, 'cycleway', 'asphalt'),
    ])
    const results = await findWorkSegments(graph, start, intervals, recording)
    expect(results).toHaveLength(2)
    expect(calls).toHaveLength(1)
    // the one call carries both candidates' resampled points
    expect(calls[0].length).toBeGreaterThan(40)
  })

  it('makes no sampler call when no candidate survives the prefilter', async () => {
    const calls: LatLon[][] = []
    const recording: ElevationSampler = async (points) => {
      calls.push(points)
      return points.map(() => 10)
    }
    const graph = buildGraph([straightWay(1, 51.45, -2.58, 3, 'residential', 'asphalt')])
    const results = await findWorkSegments(graph, start, intervals, recording)
    expect(results).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })
})

/** A way from explicit [lat, lon] points, so junction bearings are controlled. */
function pointWay(id: number, nodeIds: number[], pts: Array<[number, number]>): OsmWay {
  return {
    id,
    tags: { highway: 'residential', surface: 'asphalt' },
    nodeIds,
    points: pts.map(([lat, lon]) => ({ lat, lon })),
  }
}

const easy: TerrainRequirements = {
  maxAvgGradientPercent: 6,
  minAvgGradientPercent: null,
  maxJunctionsPerKm: 12,
  minQuietness: 0.4,
  surface: 'any',
  minUninterruptedMeters: null,
  qualityWeights: {
    quietness: 0.25,
    gradient: 0.08,
    crossingFree: 0,
    turnSmoothness: 0.04,
    turnDensity: 0.03,
    nonRepetition: 0.25,
    lengthFit: 0.35,
  },
  gradientShape: 'any',
}

describe('findWorkSegments — conversational sessions (decision 17)', () => {
  it('filters degenerate fragments below the conversational floor', async () => {
    const graph = buildGraph([straightWay(1, 51.45, -2.58, 3, 'residential', 'asphalt')]) // ~222m
    const results = await findWorkSegments(graph, start, easy, flatSampler, {
      workTargetMeters: 10000,
    })
    expect(results).toHaveLength(0)
  })

  it('extends conversational stretches toward the work target', async () => {
    // A→Jn is ~556m and Jn is a real junction (degree 3), so corridors
    // terminate there; only decision-15 assembly across the turn goes further.
    const A: [number, number] = [51.45, -2.58]
    const Jn: [number, number] = [51.455, -2.58]
    const W: [number, number] = [51.455, -2.587] // left turn
    const E: [number, number] = [51.455, -2.573] // right turn
    const graph = buildGraph([
      pointWay(1, [10, 20], [A, Jn]),
      pointWay(2, [20, 30], [Jn, W]),
      pointWay(3, [20, 40], [Jn, E]),
    ])
    const results = await findWorkSegments(graph, start, easy, flatSampler, {
      workTargetMeters: 10000,
    })
    expect(Math.max(...results.map((r) => r.lengthMeters))).toBeGreaterThan(700)
  })

  it('ranks a long stretch above a shorter quieter one', async () => {
    const graph = buildGraph([
      straightWay(1, 51.45, -2.58, 28, 'residential', 'asphalt'), // ~3000m, quietness 0.7
      straightWay(2, 51.45, -2.577, 5, 'cycleway', 'asphalt'), // ~444m, quietness 0.9
    ])
    const results = await findWorkSegments(graph, start, easy, flatSampler, {
      workTargetMeters: 10000,
      maxDistanceFromStartMeters: 4000,
    })
    expect(results.length).toBeGreaterThan(1)
    expect(results[0].lengthMeters).toBeGreaterThan(2000)
  })

  it('follows sustained paths instead of sliver turns (flow continuation)', async () => {
    const A: [number, number] = [51.45, -2.588]
    const J: [number, number] = [51.45, -2.58]
    const NearN: [number, number] = [51.4501, -2.58] // ~11m sliver left turn
    const E: [number, number] = [51.45, -2.572] // long straight continuation
    const graph = buildGraph([
      pointWay(1, [10, 20], [A, J]),
      pointWay(2, [20, 30], [J, NearN]),
      pointWay(3, [20, 50], [J, E]),
    ])
    const results = await findWorkSegments(graph, start, easy, flatSampler, {
      workTargetMeters: 10000,
    })
    expect(Math.max(...results.map((r) => r.lengthMeters))).toBeGreaterThan(1000)
  })

  it('still reports crossings as an annotation', async () => {
    // Straight-on is the only usable continuation at a degree-3 junction: a
    // crossing — tolerated for easy, but still tallied for the UI caveat.
    const A: [number, number] = [51.45, -2.58]
    const Jn: [number, number] = [51.455, -2.58]
    const N: [number, number] = [51.46, -2.58] // straight on (a crossing)
    const Bk: [number, number] = [51.45, -2.582] // doubles back — never taken
    const graph = buildGraph([
      pointWay(1, [10, 20], [A, Jn]),
      pointWay(2, [20, 50], [Jn, N]),
      pointWay(3, [20, 60], [Jn, Bk]),
    ])
    const results = await findWorkSegments(graph, start, easy, flatSampler, {
      workTargetMeters: 10000,
    })
    expect(results[0].crossings).toBe(1)
  })
})

describe('findWorkSegments — turn-aware stretches (decision 15)', () => {
  // A→J heads north (~556m), short of the 800m interval floor on its own.
  const A: [number, number] = [51.45, -2.58]
  const Jn: [number, number] = [51.455, -2.58]

  it('extends a sub-floor corridor across a left turn to qualify, crossing-free', async () => {
    const W: [number, number] = [51.455, -2.587] // left turn off the northward approach
    const E: [number, number] = [51.455, -2.573] // right turn
    const N: [number, number] = [51.46, -2.58] // straight on
    const graph = buildGraph([
      pointWay(1, [10, 20], [A, Jn]),
      pointWay(2, [20, 30], [Jn, W]),
      pointWay(3, [20, 40], [Jn, E]),
      pointWay(4, [20, 50], [Jn, N]),
    ])
    const results = await findWorkSegments(graph, start, intervals, flatSampler)
    expect(results.length).toBeGreaterThan(0)
    // The approach alone is < 800m; only assembly across the turn qualifies.
    expect(Math.max(...results.map((r) => r.lengthMeters))).toBeGreaterThan(800)
    expect(results[0].crossings).toBe(0)
  })

  it('still returns a stretch when only a straight crossing reaches the floor, caveated', async () => {
    const N: [number, number] = [51.46, -2.58] // straight on (a crossing)
    const Bk: [number, number] = [51.45, -2.582] // doubles back — never taken
    const graph = buildGraph([
      pointWay(1, [10, 20], [A, Jn]),
      pointWay(2, [20, 50], [Jn, N]),
      pointWay(3, [20, 60], [Jn, Bk]),
    ])
    const results = await findWorkSegments(graph, start, intervals, flatSampler)
    expect(results.length).toBeGreaterThan(0)
    // No crossing-free stretch reaches 800m here, so the best is crossing-bearing.
    expect(results[0].crossings).toBe(1)
  })
})
