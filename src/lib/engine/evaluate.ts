import type { GradientShape, QualityWeights, TerrainRequirements } from '@/lib/domain/types'
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
 * The default quality blend (decision 16's original weights, extended to
 * decision 18's six dimensions with the flow additions zeroed). Used when a
 * caller supplies no per-session profile — session-specific blends live in
 * `domain/profiles.ts` and reach the finder on `TerrainRequirements`.
 */
export const DEFAULT_QUALITY_WEIGHTS: QualityWeights = {
  quietness: 0.45,
  gradient: 0.25,
  crossingFree: 0.3,
  turnSmoothness: 0,
  turnDensity: 0,
  nonRepetition: 0,
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * 0–1 gradient fit: reward steepness when the session wants climb, else
 * flatness (decision 16). Shape-aware (decision 19): when the session reads a
 * shape (`even` for tempo, `sustained` for hills), the base fit is scaled by
 * `consistency` (0–1), so a rolling stretch that only *averages* to target
 * loses to a steady one. `any` (easy/long) scores on the average alone.
 */
function gradientFit(
  gradientPercent: number,
  wantsClimb: boolean,
  shape: GradientShape,
  consistency: number,
): number {
  const base = wantsClimb ? clamp01(gradientPercent / 10) : clamp01(1 - gradientPercent / 5)
  return shape === 'any' ? base : base * clamp01(consistency)
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
 * The single calibrated 0–1 segment quality (decisions 16, 18): a weighted
 * blend of two families — ground (quietness, gradient fit) and flow
 * (crossing-freeness, turn-smoothness, turn-density, non-repetition). The blend
 * `weights` come from the session profile (`domain/profiles.ts`); omitted, they
 * fall back to `DEFAULT_QUALITY_WEIGHTS`. The flow inputs default to 1 (a
 * perfectly flowing stretch) so a caller that has not computed one yet — or a
 * single stretch that repeats nothing — is scored as it was before that
 * dimension existed. This is both what the runner sees ("Quality 87%") and what
 * the finder ranks by; it orders segments that already passed the hard
 * `TerrainRequirements` gates — it never rejects.
 */
export function segmentQuality(params: {
  minQuietness: number
  gradientPercent: number
  wantsClimb: boolean
  crossings: number
  weights?: QualityWeights
  gradientShape?: GradientShape
  /** 0–1, 1 = a steady/sustained climb; scales gradient fit when shape ≠ any. */
  gradientConsistency?: number
  /** 0–1, 1 = no pace-killing sharp turns. */
  turnSmoothness?: number
  /** 0–1, 1 = a legible line with few direction changes. */
  turnDensity?: number
  /** 0–1, 1 = no retraced ground (loops/continuous routes). */
  nonRepetition?: number
}): number {
  const w = params.weights ?? DEFAULT_QUALITY_WEIGHTS
  return (
    w.quietness * clamp01(params.minQuietness) +
    w.gradient *
      gradientFit(
        params.gradientPercent,
        params.wantsClimb,
        params.gradientShape ?? 'any',
        params.gradientConsistency ?? 1,
      ) +
    w.crossingFree * crossingFreeness(params.crossings) +
    w.turnSmoothness * clamp01(params.turnSmoothness ?? 1) +
    w.turnDensity * clamp01(params.turnDensity ?? 1) +
    w.nonRepetition * clamp01(params.nonRepetition ?? 1)
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
