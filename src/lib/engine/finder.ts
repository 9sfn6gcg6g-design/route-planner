import type { TerrainRequirements } from '@/lib/domain/types'
import type { Chain, LatLon, RunGraph } from './types'
import { buildChains } from './chains'
import { evaluateChain } from './evaluate'
import { avgAbsGradientPercent } from './elevation'
import { cumulativeMeters, haversineMeters } from './geo'
import { resamplePoints } from './resample'

export type ElevationSampler = (points: LatLon[]) => Promise<number[]>

export interface FindOptions {
  /** Straight-line prefilter radius from the start point. Default 2000. */
  maxDistanceFromStartMeters?: number
  maxResults?: number
  /** Spacing for elevation sampling. Default 40. */
  resampleIntervalMeters?: number
}

export interface WorkSegment {
  points: LatLon[]
  lengthMeters: number
  distanceFromStartMeters: number
  isCycle: boolean
  minQuietness: number
  avgAbsGradientPercent: number
  score: number
}

function distanceFromStart(start: LatLon, chain: Chain): number {
  let min = Infinity
  for (const point of chain.points) {
    const d = haversineMeters(start, point)
    if (d < min) min = d
  }
  return min
}

/**
 * Find ranked work segments near a start point. Cheap checks run first —
 * distance prefilter, then static requirement checks (gradient = null) —
 * so the elevation sampler is only called for chains that could actually
 * qualify. Whole-chain evaluation only: finding a qualifying sub-window
 * inside a longer chain that fails on average is a future refinement.
 */
export async function findWorkSegments(
  graph: RunGraph,
  start: LatLon,
  requirements: TerrainRequirements,
  sampleElevations: ElevationSampler,
  options: FindOptions = {},
): Promise<WorkSegment[]> {
  const {
    maxDistanceFromStartMeters = 2000,
    maxResults = 5,
    resampleIntervalMeters = 40,
  } = options

  const candidates: Array<{ chain: Chain; distance: number }> = []
  for (const chain of buildChains(graph)) {
    const distance = distanceFromStart(start, chain)
    if (distance > maxDistanceFromStartMeters) continue
    if (!evaluateChain(chain, requirements, null).passes) continue
    candidates.push({ chain, distance })
  }

  const results: WorkSegment[] = []
  for (const { chain, distance } of candidates) {
    const resampled = resamplePoints(chain.points, resampleIntervalMeters)
    const elevations = await sampleElevations(resampled)
    const gradient = avgAbsGradientPercent(elevations, cumulativeMeters(resampled))
    const evaluation = evaluateChain(chain, requirements, gradient)
    if (!evaluation.passes) continue
    results.push({
      points: chain.points,
      lengthMeters: chain.lengthMeters,
      distanceFromStartMeters: distance,
      isCycle: chain.isCycle,
      minQuietness: evaluation.minQuietness,
      avgAbsGradientPercent: gradient,
      score: evaluation.score,
    })
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults)
}
