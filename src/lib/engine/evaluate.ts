import type { TerrainRequirements } from '@/lib/domain/types'
import type { Chain } from './types'

export interface ChainEvaluation {
  passes: boolean
  failures: string[]
  minQuietness: number
  score: number
}

export function chainMinQuietness(chain: Chain): number {
  return chain.edges.reduce((min, e) => Math.min(min, e.quietness), 1)
}

/**
 * Check a chain against a work phase's terrain requirements and score it
 * for ranking. Pass gradientPercent = null to run only the static checks
 * (length, quietness, surface) — the finder uses that as a cheap prefilter
 * before spending elevation lookups.
 *
 * maxJunctionsPerKm needs no check here: chains have no interior true
 * crossings by construction (see buildChains).
 *
 * The score is a v1 ranking heuristic, not a calibrated quantity:
 * quietness dominates, then gradient fit (flatness — or steepness when the
 * session wants climb), then a capped bonus for longer stretches.
 */
export function evaluateChain(
  chain: Chain,
  requirements: TerrainRequirements,
  gradientPercent: number | null,
): ChainEvaluation {
  const failures: string[] = []
  const minQuietness = chainMinQuietness(chain)

  if (
    requirements.minUninterruptedMeters !== null &&
    chain.lengthMeters < requirements.minUninterruptedMeters
  ) {
    failures.push(
      `stretch is ${Math.round(chain.lengthMeters)}m, shorter than the required ${requirements.minUninterruptedMeters}m`,
    )
  }
  if (minQuietness < requirements.minQuietness) {
    failures.push(`quietness ${minQuietness} is below the required ${requirements.minQuietness}`)
  }
  if (requirements.surface === 'paved' && !chain.edges.every((e) => e.surface === 'paved')) {
    failures.push('surface is not verifiably paved throughout (unknown fails closed)')
  }
  if (gradientPercent !== null) {
    if (gradientPercent > requirements.maxAvgGradientPercent) {
      failures.push(
        `gradient ${gradientPercent.toFixed(1)}% exceeds the maximum ${requirements.maxAvgGradientPercent}%`,
      )
    }
    if (
      requirements.minAvgGradientPercent !== null &&
      gradientPercent < requirements.minAvgGradientPercent
    ) {
      failures.push(
        `gradient ${gradientPercent.toFixed(1)}% is below the required ${requirements.minAvgGradientPercent}%`,
      )
    }
  }

  const wantsClimb = requirements.minAvgGradientPercent !== null
  let score = minQuietness * 2 + Math.min(chain.lengthMeters / 1000, 2) * 0.25
  if (gradientPercent !== null) {
    score += wantsClimb
      ? Math.min(gradientPercent / 10, 1)
      : Math.max(0, 1 - gradientPercent / 5)
  }

  return { passes: failures.length === 0, failures, minQuietness, score }
}
