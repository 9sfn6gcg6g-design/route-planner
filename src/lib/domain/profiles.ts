import type { QualityWeights, Session, TerrainRequirements } from './types'

/**
 * Per-session quality blends (decision 18). Structured work (tempo/intervals/
 * hills) weights the flow dimensions — crossing-freeness, turn-smoothness,
 * turn-density — high, because a hard effort is wrecked by forced stops,
 * hairpins and constant navigation; non-repetition is ~0 since a rep session
 * repeats one segment by design (decision 21). Easy/long invert it: they relax
 * flow and weight non-repetition high, so the run varies its ground rather than
 * pounding an out-and-back. Every profile sums to 1.
 */
const INTERVALS_WEIGHTS: QualityWeights = {
  quietness: 0.3,
  gradient: 0.18,
  crossingFree: 0.27,
  turnSmoothness: 0.15,
  turnDensity: 0.1,
  nonRepetition: 0,
}
const TEMPO_WEIGHTS: QualityWeights = {
  quietness: 0.32,
  gradient: 0.18,
  crossingFree: 0.25,
  turnSmoothness: 0.15,
  turnDensity: 0.1,
  nonRepetition: 0,
}
const HILLS_WEIGHTS: QualityWeights = {
  quietness: 0.25,
  gradient: 0.35,
  crossingFree: 0.2,
  turnSmoothness: 0.12,
  turnDensity: 0.08,
  nonRepetition: 0,
}
const EASY_WEIGHTS: QualityWeights = {
  quietness: 0.35,
  gradient: 0.15,
  crossingFree: 0.1,
  turnSmoothness: 0.05,
  turnDensity: 0.05,
  nonRepetition: 0.3,
}
const LONG_WEIGHTS: QualityWeights = {
  quietness: 0.4,
  gradient: 0.12,
  crossingFree: 0.1,
  turnSmoothness: 0.04,
  turnDensity: 0.04,
  nonRepetition: 0.3,
}

/**
 * Terrain-requirement profile per session type. Values are the product
 * decisions from the 2026-07-26 grilling session: intervals want flat,
 * smooth, quiet, uninterrupted; hills invert the gradient requirement;
 * easy/long relax everything. maxJunctionsPerKm counts tolerated minor joins
 * per km (see engine chains), not road crossings. `qualityWeights` and
 * `gradientShape` carry decisions 18/19 into the engine (which never sees pace).
 */
export function terrainRequirementsFor(session: Session): TerrainRequirements {
  switch (session.type) {
    case 'easy':
      return {
        maxAvgGradientPercent: 6,
        minAvgGradientPercent: null,
        maxJunctionsPerKm: 12,
        minQuietness: 0.4,
        surface: 'any',
        minUninterruptedMeters: null,
        qualityWeights: EASY_WEIGHTS,
        gradientShape: 'any',
      }
    case 'long':
      return {
        maxAvgGradientPercent: 5,
        minAvgGradientPercent: null,
        maxJunctionsPerKm: 10,
        minQuietness: 0.5,
        surface: 'any',
        minUninterruptedMeters: null,
        qualityWeights: LONG_WEIGHTS,
        gradientShape: 'any',
      }
    case 'tempo':
      return {
        maxAvgGradientPercent: 2,
        minAvgGradientPercent: null,
        maxJunctionsPerKm: 6,
        minQuietness: 0.6,
        surface: 'paved',
        minUninterruptedMeters: Math.min(session.tempoMeters, 1500),
        qualityWeights: TEMPO_WEIGHTS,
        gradientShape: 'even',
      }
    case 'intervals':
      return {
        maxAvgGradientPercent: 1,
        minAvgGradientPercent: null,
        maxJunctionsPerKm: 6,
        minQuietness: 0.7,
        surface: 'paved',
        minUninterruptedMeters: session.repMeters,
        qualityWeights: INTERVALS_WEIGHTS,
        gradientShape: 'even',
      }
    case 'hills':
      return {
        maxAvgGradientPercent: 15,
        minAvgGradientPercent: 4,
        maxJunctionsPerKm: 6,
        minQuietness: 0.5,
        surface: 'any',
        minUninterruptedMeters: session.hillMeters,
        qualityWeights: HILLS_WEIGHTS,
        gradientShape: 'sustained',
      }
  }
}
