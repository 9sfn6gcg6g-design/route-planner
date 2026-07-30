import type { TerrainRequirements } from '@/lib/domain/types'
import type { Chain, LatLon, RunGraph } from './types'
import { assembleStretches } from './stretches'
import { evaluateChain, segmentQuality } from './evaluate'
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
  /** Chain ends coincide; may still hang off a crossing. */
  isCycle: boolean
  minQuietness: number
  avgAbsGradientPercent: number
  /** Forced road crossings on this stretch (decision 15); 0 = crossing-free. */
  crossings: number
  /** Single calibrated 0–1 quality (decision 16); the list is ranked and shown by it. */
  quality: number
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
 * Find ranked work segments near a start point. Stretches are assembled with a
 * length floor (decision 15): where a corridor is too short, it is extended
 * across junctions by turning, so a qualifying stretch can be found without
 * crossing roads. Cheap checks run first — distance prefilter, then static
 * requirement checks (gradient = null) — so the elevation sampler is only
 * called for stretches that could actually qualify. All surviving candidates'
 * resampled points are batched into a single elevation call. Crossing-free
 * stretches rank above crossing-bearing ones; the whole stretch is still
 * evaluated on average (a sub-window search remains a future refinement).
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

  const candidates: Array<{ chain: Chain; distance: number; crossings: number }> = []
  for (const { chain, crossings } of assembleStretches(graph, {
    targetMeters: requirements.minUninterruptedMeters ?? 0,
  })) {
    const distance = distanceFromStart(start, chain)
    if (distance > maxDistanceFromStartMeters) continue
    if (!evaluateChain(chain, requirements, null).passes) continue
    candidates.push({ chain, distance, crossings })
  }

  const results: WorkSegment[] = []
  if (candidates.length > 0) {
    const resampledAll = candidates.map(({ chain }) =>
      resamplePoints(chain.points, resampleIntervalMeters),
    )
    // One batched call for every candidate; fetchElevations chunks by 100
    // internally, so this is at most a couple of HTTP requests total.
    const elevations = await sampleElevations(resampledAll.flat())
    let offset = 0
    for (let i = 0; i < candidates.length; i++) {
      const { chain, distance, crossings } = candidates[i]
      const resampled = resampledAll[i]
      const slice = elevations.slice(offset, offset + resampled.length)
      offset += resampled.length
      const gradient = avgAbsGradientPercent(slice, cumulativeMeters(resampled))
      const evaluation = evaluateChain(chain, requirements, gradient)
      if (!evaluation.passes) continue
      const quality = segmentQuality({
        minQuietness: evaluation.minQuietness,
        gradientPercent: gradient,
        wantsClimb: requirements.minAvgGradientPercent !== null,
        crossings,
        lengthMeters: chain.lengthMeters,
        conversationalTargetMeters: null,
      })
      results.push({
        points: chain.points,
        lengthMeters: chain.lengthMeters,
        distanceFromStartMeters: distance,
        isCycle: chain.isCycle,
        minQuietness: evaluation.minQuietness,
        avgAbsGradientPercent: gradient,
        crossings,
        quality,
      })
    }
  }

  // Rank by the single quality score (decision 16). Crossings are weighted into
  // quality, so crossing-free stretches lead all else equal without a hard gate.
  return results.sort((a, b) => b.quality - a.quality).slice(0, maxResults)
}
