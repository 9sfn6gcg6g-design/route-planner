import { describe, expect, it } from 'vitest'
import type { TerrainRequirements } from '@/lib/domain/types'
import { buildGraph } from './graph'
import { findWorkSegments, type ElevationSampler } from './finder'
import type { LatLon, OsmWay } from './types'

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
  maxJunctionsPerKm: 1,
  minQuietness: 0.7,
  surface: 'paved',
  minUninterruptedMeters: 800,
}

const hills: TerrainRequirements = {
  maxAvgGradientPercent: 15,
  minAvgGradientPercent: 4,
  maxJunctionsPerKm: 2,
  minQuietness: 0.5,
  surface: 'any',
  minUninterruptedMeters: 300,
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
})
