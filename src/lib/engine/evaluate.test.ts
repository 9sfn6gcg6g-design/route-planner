import { describe, expect, it } from 'vitest'
import type { QualityWeights, TerrainRequirements } from '@/lib/domain/types'
import { chainMinQuietness, DEFAULT_QUALITY_WEIGHTS, evaluateChain, segmentQuality } from './evaluate'
import type { Chain, RunEdge, SurfaceKind } from './types'

/** A structured profile: flow (crossings/turns) weighted high, repetition ~0. */
const structuredWeights: QualityWeights = {
  quietness: 0.3,
  gradient: 0.18,
  crossingFree: 0.27,
  turnSmoothness: 0.15,
  turnDensity: 0.1,
  nonRepetition: 0,
}
/** An easy profile: flow relaxed, non-repetition weighted high. */
const easyWeights: QualityWeights = {
  quietness: 0.35,
  gradient: 0.15,
  crossingFree: 0.1,
  turnSmoothness: 0.05,
  turnDensity: 0.05,
  nonRepetition: 0.3,
}

function edge(lengthMeters: number, quietness: number, surface: SurfaceKind): RunEdge {
  return {
    wayId: 1,
    fromNodeId: 1,
    toNodeId: 2,
    points: [
      { lat: 51.45, lon: -2.58 },
      { lat: 51.46, lon: -2.58 },
    ],
    lengthMeters,
    highway: 'residential',
    quietness,
    surface,
  }
}

function chain(edges: RunEdge[]): Chain {
  return {
    edges,
    points: edges.flatMap((e) => e.points),
    lengthMeters: edges.reduce((s, e) => s + e.lengthMeters, 0),
    startNodeId: 1,
    endNodeId: 2,
    isCycle: false,
    toleratedJunctionNodeIds: [],
  }
}

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
  qualityWeights: { quietness: 0.25, gradient: 0.35, crossingFree: 0.2, turnSmoothness: 0.12, turnDensity: 0.08, nonRepetition: 0 },
  gradientShape: 'sustained',
}

describe('chainMinQuietness', () => {
  it('is the minimum over edges', () => {
    expect(chainMinQuietness(chain([edge(100, 0.9, 'paved'), edge(100, 0.6, 'paved')]))).toBe(0.6)
  })
})

describe('evaluateChain — static checks (gradient null)', () => {
  it('passes a long quiet paved chain', () => {
    const result = evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, null)
    expect(result.passes).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('fails a chain shorter than minUninterruptedMeters', () => {
    const result = evaluateChain(chain([edge(500, 0.9, 'paved')]), intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/800/)
  })

  it('fails when any edge is louder than minQuietness', () => {
    const result = evaluateChain(chain([edge(600, 0.9, 'paved'), edge(600, 0.45, 'paved')]), intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/quietness/i)
  })

  it('fails closed: unknown surface does not satisfy a paved requirement', () => {
    const result = evaluateChain(chain([edge(1000, 0.9, 'unknown')]), intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/paved/i)
  })

  it('surface any accepts unpaved and unknown', () => {
    const result = evaluateChain(chain([edge(500, 0.9, 'unknown')]), hills, null)
    expect(result.passes).toBe(true)
  })
})

describe('evaluateChain — gradient checks', () => {
  it('fails intervals on a 3% gradient', () => {
    const result = evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, 3)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/gradient/i)
  })

  it('passes intervals on flat ground', () => {
    expect(evaluateChain(chain([edge(1000, 0.9, 'paved')]), intervals, 0.3).passes).toBe(true)
  })

  it('hills require climb: flat fails, steep passes', () => {
    const flat = evaluateChain(chain([edge(500, 0.9, 'paved')]), hills, 0.5)
    expect(flat.passes).toBe(false)
    const steep = evaluateChain(chain([edge(500, 0.9, 'paved')]), hills, 8)
    expect(steep.passes).toBe(true)
  })
})

describe('segmentQuality (decision 16)', () => {
  const base = { minQuietness: 0.9, gradientPercent: 0.3, wantsClimb: false, crossings: 0 }

  it('is a calibrated 0–1 score', () => {
    const q = segmentQuality(base)
    expect(q).toBeGreaterThan(0)
    expect(q).toBeLessThanOrEqual(1)
  })

  it('prefers quieter stretches, all else equal', () => {
    expect(segmentQuality({ ...base, minQuietness: 0.9 })).toBeGreaterThan(
      segmentQuality({ ...base, minQuietness: 0.7 }),
    )
  })

  it('prefers flatter for flat sessions and steeper for climbs', () => {
    expect(segmentQuality({ ...base, gradientPercent: 0.2 })).toBeGreaterThan(
      segmentQuality({ ...base, gradientPercent: 0.9 }),
    )
    const climb = { minQuietness: 0.9, wantsClimb: true, crossings: 0 }
    expect(segmentQuality({ ...climb, gradientPercent: 9 })).toBeGreaterThan(
      segmentQuality({ ...climb, gradientPercent: 5 }),
    )
  })

  it('prefers crossing-free stretches, all else equal', () => {
    expect(segmentQuality({ ...base, crossings: 0 })).toBeGreaterThan(
      segmentQuality({ ...base, crossings: 1 }),
    )
    expect(segmentQuality({ ...base, crossings: 1 })).toBeGreaterThan(
      segmentQuality({ ...base, crossings: 3 }),
    )
  })
})

describe('decision 18: flow is session-weighted', () => {
  const base = { minQuietness: 0.8, gradientPercent: 0.3, wantsClimb: false, crossings: 0 }

  it('omitting weights equals the default profile, which sums to 1', () => {
    const sum = Object.values(DEFAULT_QUALITY_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1)
    expect(segmentQuality(base)).toBeCloseTo(
      segmentQuality({ ...base, weights: DEFAULT_QUALITY_WEIGHTS }),
    )
  })

  it('a road crossing costs a structured session more than an easy one', () => {
    const drop = (weights: QualityWeights): number =>
      segmentQuality({ ...base, weights, crossings: 0 }) -
      segmentQuality({ ...base, weights, crossings: 2 })
    expect(drop(structuredWeights)).toBeGreaterThan(drop(easyWeights))
  })

  it('a hairpin (low turn-smoothness) costs a structured session more than an easy one', () => {
    const drop = (weights: QualityWeights): number =>
      segmentQuality({ ...base, weights, turnSmoothness: 1 }) -
      segmentQuality({ ...base, weights, turnSmoothness: 0.2 })
    expect(drop(structuredWeights)).toBeGreaterThan(drop(easyWeights))
  })

  it('a zig-zag (low turn-density) costs a structured session more than an easy one', () => {
    const drop = (weights: QualityWeights): number =>
      segmentQuality({ ...base, weights, turnDensity: 1 }) -
      segmentQuality({ ...base, weights, turnDensity: 0.2 })
    expect(drop(structuredWeights)).toBeGreaterThan(drop(easyWeights))
  })

  it('retraced ground (low non-repetition) costs easy far more than structured', () => {
    const drop = (weights: QualityWeights): number =>
      segmentQuality({ ...base, weights, nonRepetition: 1 }) -
      segmentQuality({ ...base, weights, nonRepetition: 0.2 })
    expect(drop(easyWeights)).toBeGreaterThan(drop(structuredWeights))
  })

  it('every session profile stays in [0, 1] at its worst inputs', () => {
    const worst = {
      minQuietness: 0,
      gradientPercent: 20,
      wantsClimb: false,
      crossings: 5,
      turnSmoothness: 0,
      turnDensity: 0,
      nonRepetition: 0,
    }
    for (const weights of [structuredWeights, easyWeights]) {
      const q = segmentQuality({ ...worst, weights })
      expect(q).toBeGreaterThanOrEqual(0)
      expect(q).toBeLessThanOrEqual(1)
    }
  })
})

describe('decision 19: gradient shape scales fit', () => {
  const climb = { minQuietness: 0.9, gradientPercent: 8, wantsClimb: true, crossings: 0 }

  it('a rolling climb (low consistency) scores below a sustained one for hills', () => {
    const sustained = segmentQuality({ ...climb, gradientShape: 'sustained', gradientConsistency: 1 })
    const rolling = segmentQuality({ ...climb, gradientShape: 'sustained', gradientConsistency: 0.3 })
    expect(sustained).toBeGreaterThan(rolling)
  })

  it('shape "any" ignores consistency (easy/long score on the average alone)', () => {
    const flat = { minQuietness: 0.9, gradientPercent: 0.3, wantsClimb: false, crossings: 0 }
    expect(segmentQuality({ ...flat, gradientShape: 'any', gradientConsistency: 0.2 })).toBeCloseTo(
      segmentQuality({ ...flat, gradientShape: 'any', gradientConsistency: 1 }),
    )
  })
})

describe('junction density', () => {
  it('fails a chain with too many tolerated junctions per km', () => {
    const c = chain([edge(1000, 0.9, 'paved')])
    c.toleratedJunctionNodeIds = [1, 2, 3, 4, 5, 6, 7]
    const result = evaluateChain(c, intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/junction/i)
  })

  it('passes a chain with acceptable tolerated-junction density', () => {
    const c = chain([edge(1000, 0.9, 'paved')])
    c.toleratedJunctionNodeIds = [1, 2, 3]
    expect(evaluateChain(c, intervals, null).passes).toBe(true)
  })

  it('does not silently pass a zero-length chain (0/0 must not evaluate as an acceptable density)', () => {
    const result = evaluateChain(chain([edge(0, 0.9, 'paved')]), intervals, null)
    expect(result.passes).toBe(false)
    expect(result.failures.join(' ')).toMatch(/junction/i)
  })
})
