import type { TerrainRequirements } from '@/lib/domain/types'
import type { Chain } from './types'

export interface ChainEvaluation {
  passes: boolean
  failures: string[]
  minQuietness: number
}

export function chainMinQuietness(chain: Chain): number {
  return chain.edges.reduce((min, e) => Math.min(min, e.quietness), 1)
}

/**
 * Length-weighted mean quietness (decision 17): the ranking statistic for
 * conversational stretches, where one louder link doesn't define the run the
 * way it breaks a rep. Hard gates keep using the minimum.
 */
export function chainMeanQuietness(chain: Chain): number {
  const total = chain.edges.reduce((sum, e) => sum + e.lengthMeters, 0)
  if (total === 0) return chainMinQuietness(chain)
  return chain.edges.reduce((sum, e) => sum + e.quietness * e.lengthMeters, 0) / total
}

/**
 * How much each dimension counts toward the single 0–1 quality score
 * (decision 16). Quietness leads; gradient fit and crossing-freeness follow.
 * The weights sum to 1 so quality lands in [0, 1]. v1 constants, tunable.
 */
const WORK_QUALITY_WEIGHTS = { quietness: 0.45, gradient: 0.25, crossingFree: 0.3 }

/**
 * Conversational sessions (decision 17) tolerate crossings: crossing-freeness
 * is replaced by length-fit — stretch length over the capped work-phase
 * target, clamped to 1. Weights sum to 1. v1 constants, tunable.
 */
const CONVERSATIONAL_QUALITY_WEIGHTS = { quietness: 0.45, gradient: 0.15, lengthFit: 0.4 }

/**
 * Conversational gradient fit (decision 17): gentler than the work flatness
 * curve — rolling ground is fine at conversational effort, and terrain-tile
 * noise must not crater a long stretch's score. Zero only at 10% average.
 */
const conversationalGradientFit = (gradientPercent: number): number =>
  clamp01(1 - gradientPercent / 10)

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** 0–1 gradient fit: reward steepness when the session wants climb, else flatness. */
function gradientFit(gradientPercent: number, wantsClimb: boolean): number {
  return wantsClimb ? clamp01(gradientPercent / 10) : clamp01(1 - gradientPercent / 5)
}

/**
 * 0–1 crossing-freeness: 1 for a crossing-free stretch, decaying as forced
 * road crossings (decision 15) accumulate — 1 → 0.5 → 0.33 for 0, 1, 2
 * crossings. Weighted into quality so crossings cost pace without hard-gating.
 */
function crossingFreeness(crossings: number): number {
  return 1 / (1 + Math.max(0, crossings))
}

/**
 * The single calibrated 0–1 segment quality (decision 16): a weighted blend of
 * quietness, gradient fit and crossing-freeness. This is both what the runner
 * sees ("Quality 87%") and what the finder ranks by. It orders segments that
 * have already passed the hard `TerrainRequirements` gates — it never rejects.
 */
export function segmentQuality(params: {
  /** The caller's quietness statistic: minimum for work stretches, length-weighted mean for conversational (decision 17). */
  quietness: number
  gradientPercent: number
  wantsClimb: boolean
  crossings: number
  lengthMeters: number
  /** Capped work-phase target for conversational sessions (decision 17); null = work stretch. */
  conversationalTargetMeters: number | null
}): number {
  const quietness = clamp01(params.quietness)
  if (params.conversationalTargetMeters !== null) {
    const w = CONVERSATIONAL_QUALITY_WEIGHTS
    return (
      w.quietness * quietness +
      w.gradient * conversationalGradientFit(params.gradientPercent) +
      w.lengthFit * clamp01(params.lengthMeters / params.conversationalTargetMeters)
    )
  }
  const w = WORK_QUALITY_WEIGHTS
  return (
    w.quietness * quietness +
    w.gradient * gradientFit(params.gradientPercent, params.wantsClimb) +
    w.crossingFree * crossingFreeness(params.crossings)
  )
}

/**
 * Check a chain against a work phase's terrain requirements. Pass
 * gradientPercent = null to run only the static checks (length, quietness,
 * surface, junction density) — the finder uses that as a cheap prefilter
 * before spending elevation lookups. Ranking is not this function's job:
 * `segmentQuality` computes the 0–1 quality the finder sorts and displays by.
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

  // Chains never contain interior MAJOR crossings (buildChains terminates
  // there); maxJunctionsPerKm bounds the tolerated minor joins per km. A
  // zero-length chain has no km to divide by (0/0 is NaN, and `NaN > max`
  // is always false) — treat it as infinitely dense so it fails any finite
  // maximum instead of silently passing.
  const junctionsPerKm =
    chain.lengthMeters > 0
      ? chain.toleratedJunctionNodeIds.length / (chain.lengthMeters / 1000)
      : Infinity
  if (junctionsPerKm > requirements.maxJunctionsPerKm) {
    failures.push(
      `junction density ${junctionsPerKm.toFixed(1)}/km exceeds the maximum ${requirements.maxJunctionsPerKm}/km`,
    )
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

  return { passes: failures.length === 0, failures, minQuietness }
}
